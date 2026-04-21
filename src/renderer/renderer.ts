import type {
  ParseResult,
  DoxygenFile,
  DoxygenCompound,
  DoxygenFunction,
  DoxygenEnum,
  DoxygenStruct,
  DoxygenTypedef,
  DoxygenMacro,
  DoxygenVariable,
  DoxygenClassCompound,
  DoxygenNamespaceCompound,
  DoxygenGroupCompound,
  DoxygenPageCompound,
  MemberGroup,
  SourceLocation,
} from "../parser/types.js";
import { filePathToPagePath } from "../parser/utils.js";
import { analyze } from "../analyzer/cross-references.js";
import type { AnalysisResult } from "../analyzer/types.js";
import type {
  TemplateSet,
  RenderContext,
  RenderOptions,
  FunctionGroup,
  RenderedOutput,
  RenderedFile,
  DirectoryEntry,
  DirectoryIndexEntry,
  DirectoryIndexContext,
  ApiCounts,
} from "./types.js";

/** Threshold: skip TypeUsedBy for types referenced from more than this many files */
const TYPE_USED_BY_FILE_THRESHOLD = 30;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


function resolveAnchors(content: string, templates: TemplateSet): string {
  return content.replace(/\{\{dxanchor:([^}]+)\}\}/g, (_, id) => templates.anchor(id));
}

function resolveDescriptionLinks(content: string, templates: TemplateSet): string {
  return content.replace(/\{\{dxlink:([^|]+)\|([^}]+)\}\}/g, (_, display, path) => templates.descriptionLink(display, path));
}

function computeApiCounts(compound: { functions: DoxygenFunction[]; enums: DoxygenEnum[]; structs: DoxygenStruct[]; typedefs: DoxygenTypedef[]; macros?: DoxygenMacro[]; variables: DoxygenVariable[] }): ApiCounts {
  return {
    functions: compound.functions.length,
    enums: compound.enums.length,
    structs: compound.structs.length,
    typedefs: compound.typedefs.length,
    macros: compound.macros?.length ?? 0,
    variables: compound.variables.length,
  };
}

export function render(
  parseResult: ParseResult,
  templates: TemplateSet,
  options?: RenderOptions,
): RenderedOutput {
  const files: RenderedFile[] = [];
  const compoundFiles: { compound: DoxygenCompound; path: string }[] = [];

  const compounds = parseResult.compounds ?? parseResult.files;

  // Run cross-reference analysis
  const analysis = analyze(parseResult);

  for (const compound of compounds) {
    const rendered = renderCompound(compound, templates, parseResult, analysis, options);
    if (rendered) {
      rendered.content = resolveAnchors(rendered.content, templates);
      rendered.content = resolveDescriptionLinks(rendered.content, templates);
      files.push(rendered);
      compoundFiles.push({ compound, path: rendered.path });
    }
  }

  // Post-pass: generate directory metadata and index pages
  const dirMap = new Map<string, DirectoryEntry[]>();
  const dirIndexMap = new Map<string, DirectoryIndexEntry[]>();

  for (const { compound, path } of compoundFiles) {
    const lastSlash = path.lastIndexOf("/");
    const dirPath = lastSlash >= 0 ? path.substring(0, lastSlash) : ".";
    const fileNameWithExt = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    const dotIdx = fileNameWithExt.lastIndexOf(".");
    const fileName = dotIdx >= 0 ? fileNameWithExt.substring(0, dotIdx) : fileNameWithExt;

    const title = getCompoundTitle(compound);

    if (!dirMap.has(dirPath)) {
      dirMap.set(dirPath, []);
    }
    dirMap.get(dirPath)!.push({ fileName, title, kind: compound.kind });

    // Build index entries for file compounds
    if (compound.kind === "file" && templates.directoryIndex) {
      if (!dirIndexMap.has(dirPath)) {
        dirIndexMap.set(dirPath, []);
      }
      dirIndexMap.get(dirPath)!.push({
        fileName,
        title,
        kind: compound.kind,
        brief: compound.brief,
        counts: computeApiCounts(compound),
      });
    }
  }

  // Ensure every ancestor directory also has entries in dirMap/dirIndexMap.
  // e.g. if we have "widgets/arc" and "widgets/bar", ensure "widgets" and "." exist
  // with subdirectory entries pointing to "arc" and "bar".
  const allDirs = new Set(dirMap.keys());
  for (const dirPath of [...allDirs]) {
    let current = dirPath;
    while (current.includes("/")) {
      const parentSlash = current.lastIndexOf("/");
      const parentPath = parentSlash >= 0 ? current.substring(0, parentSlash) : ".";
      const childName = parentSlash >= 0 ? current.substring(parentSlash + 1) : current;

      if (!dirMap.has(parentPath)) {
        dirMap.set(parentPath, []);
      }
      const parentEntries = dirMap.get(parentPath)!;
      if (!parentEntries.some((e) => e.fileName === childName && e.isDirectory)) {
        const childTitle = capitalize(childName);
        parentEntries.push({ fileName: childName, title: childTitle, kind: "directory", isDirectory: true });
      }

      if (!dirIndexMap.has(parentPath)) {
        dirIndexMap.set(parentPath, []);
      }
      const parentIndexEntries = dirIndexMap.get(parentPath)!;
      if (!parentIndexEntries.some((e) => e.fileName === childName && e.isDirectory)) {
        const childTitle = capitalize(childName);
        parentIndexEntries.push({
          fileName: childName,
          title: childTitle,
          kind: "directory",
          brief: "",
          counts: { functions: 0, enums: 0, structs: 0, typedefs: 0, macros: 0, variables: 0 },
          isDirectory: true,
        });
      }

      current = parentPath;
    }
    // After walking up, `current` is the top-level directory name (no slashes).
    // Ensure the root "." knows about it.
    if (current !== "." && !current.includes("/")) {
      if (!dirMap.has(".")) {
        dirMap.set(".", []);
      }
      const rootEntries = dirMap.get(".")!;
      if (!rootEntries.some((e) => e.fileName === current && e.isDirectory)) {
        rootEntries.push({ fileName: current, title: capitalize(current), kind: "directory", isDirectory: true });
      }

      if (!dirIndexMap.has(".")) {
        dirIndexMap.set(".", []);
      }
      const rootIndexEntries = dirIndexMap.get(".")!;
      if (!rootIndexEntries.some((e) => e.fileName === current && e.isDirectory)) {
        rootIndexEntries.push({
          fileName: current,
          title: capitalize(current),
          kind: "directory",
          brief: "",
          counts: { functions: 0, enums: 0, structs: 0, typedefs: 0, macros: 0, variables: 0 },
          isDirectory: true,
        });
      }
    }
  }

  // Bottom-up aggregation: sum leaf file counts into their parent directory entries
  // Sort directory paths by depth (deepest first) so children aggregate before parents
  const sortedDirPaths = [...dirIndexMap.keys()].sort((a, b) => {
    const depthA = a === "." ? 0 : a.split("/").length;
    const depthB = b === "." ? 0 : b.split("/").length;
    return depthB - depthA;
  });

  for (const dirPath of sortedDirPaths) {
    const entries = dirIndexMap.get(dirPath)!;
    // Sum counts of all entries in this directory (both leaf files and already-aggregated subdirs)
    const dirTotal: ApiCounts = { functions: 0, enums: 0, structs: 0, typedefs: 0, macros: 0, variables: 0 };
    for (const entry of entries) {
      dirTotal.functions += entry.counts.functions;
      dirTotal.enums += entry.counts.enums;
      dirTotal.structs += entry.counts.structs;
      dirTotal.typedefs += entry.counts.typedefs;
      dirTotal.macros += entry.counts.macros;
      dirTotal.variables += entry.counts.variables;
    }

    // Find this directory's entry in its parent and update its counts
    if (dirPath !== ".") {
      const lastSlash = dirPath.lastIndexOf("/");
      const parentPath = lastSlash >= 0 ? dirPath.substring(0, lastSlash) : ".";
      const childName = lastSlash >= 0 ? dirPath.substring(lastSlash + 1) : dirPath;
      const parentEntries = dirIndexMap.get(parentPath);
      if (parentEntries) {
        const parentEntry = parentEntries.find((e) => e.fileName === childName && e.isDirectory);
        if (parentEntry) {
          parentEntry.counts = dirTotal;
        }
      }
    }
  }

  if (templates.directoryMeta) {
    for (const [dirPath, entries] of dirMap) {
      const metaFile = templates.directoryMeta(dirPath, entries);
      if (metaFile) {
        files.push(metaFile);
      }
    }
  }

  // Generate directory index pages
  if (templates.directoryIndex) {
    for (const [dirPath, entries] of dirIndexMap) {
      if (entries.length === 0) continue;

      let context: DirectoryIndexContext | undefined;
      if (dirPath === ".") {
        // Compute grand totals by summing all entries in root
        const totalCounts: ApiCounts = { functions: 0, enums: 0, structs: 0, typedefs: 0, macros: 0, variables: 0 };
        for (const entry of entries) {
          totalCounts.functions += entry.counts.functions;
          totalCounts.enums += entry.counts.enums;
          totalCounts.structs += entry.counts.structs;
          totalCounts.typedefs += entry.counts.typedefs;
          totalCounts.macros += entry.counts.macros;
          totalCounts.variables += entry.counts.variables;
        }
        context = {
          introContent: options?.rootIntroContent,
          totalCounts,
        };
      }

      const indexFile = templates.directoryIndex(dirPath, entries, context);
      if (indexFile) {
        files.push(indexFile);
      }
    }
  }

  return { files };
}

function getCompoundTitle(compound: DoxygenCompound): string {
  switch (compound.kind) {
    case "file":
    case "class":
    case "namespace":
      return compound.name;
    case "group":
    case "page":
      return compound.title;
  }
}

function renderCompound(
  compound: DoxygenCompound,
  templates: TemplateSet,
  parseResult: ParseResult,
  analysis: AnalysisResult,
  options?: RenderOptions,
): RenderedFile | null {
  switch (compound.kind) {
    case "file":
      return renderFile(compound, templates, parseResult, analysis, options);
    case "class":
      return renderClass(compound, templates, parseResult, analysis);
    case "namespace":
      return renderNamespace(compound, templates, parseResult, analysis, options);
    case "group":
      return renderGroup(compound, templates, parseResult, analysis, options);
    case "page":
      return renderPage(compound, templates);
    default: {
      const _exhaustive: never = compound;
      return null;
    }
  }
}

// ── Shared section rendering ──

interface SectionSpec<T> {
  title: string;
  kind: string;
  items: T[];
  render: (item: T, ctx: RenderContext) => string;
  getName: (item: T) => string;
  getLocation?: (item: T) => SourceLocation | undefined;
}

export function classifyFunction(name: string): "Setters" | "Getters" | "Other" {
  if (/_set_/.test(name) || name.endsWith("_set")) return "Setters";
  if (/_get_/.test(name) || name.endsWith("_get")) return "Getters";
  return "Other";
}

function renderTypeUsedBy(
  typeName: string,
  templates: TemplateSet,
  analysis: AnalysisResult | undefined,
): string {
  if (!analysis || !templates.typeUsedBy) return "";
  const entries = analysis.typeUsage.get(typeName);
  if (!entries || entries.length === 0) return "";

  // Skip hub types referenced from too many files
  const hubCount = analysis.typeHubCounts.get(typeName) ?? 0;
  if (hubCount > TYPE_USED_BY_FILE_THRESHOLD) return "";

  return templates.typeUsedBy(typeName, entries);
}

function renderMemberSections(
  templates: TemplateSet,
  ctx: RenderContext,
  members: {
    functions: DoxygenFunction[];
    enums: DoxygenEnum[];
    structs: DoxygenStruct[];
    typedefs: DoxygenTypedef[];
    macros?: DoxygenMacro[];
    variables: DoxygenVariable[];
  },
  titlePrefix?: string,
  options?: RenderOptions,
): string[] {
  const p = titlePrefix ? `${titlePrefix} ` : "";
  const specs: SectionSpec<unknown>[] = [
    { title: `${p}Functions`, kind: "function", items: members.functions, render: (fn, c) => templates.function(fn as DoxygenFunction, c), getName: (fn) => (fn as DoxygenFunction).name, getLocation: (fn) => (fn as DoxygenFunction).location },
    { title: `${p}Enums`, kind: "enum", items: members.enums, render: (en, c) => templates.enum(en as DoxygenEnum, c), getName: (en) => (en as DoxygenEnum).name, getLocation: (en) => (en as DoxygenEnum).location },
    { title: `${p}Structs`, kind: "struct", items: members.structs, render: (st, c) => templates.struct(st as DoxygenStruct, c), getName: (st) => (st as DoxygenStruct).name, getLocation: (st) => (st as DoxygenStruct).location },
    { title: `${p}Typedefs`, kind: "typedef", items: members.typedefs, render: (td, c) => templates.typedef(td as DoxygenTypedef, c), getName: (td) => (td as DoxygenTypedef).name, getLocation: (td) => (td as DoxygenTypedef).location },
  ];

  if (members.macros) {
    specs.push({ title: `${p}Macros`, kind: "macro", items: members.macros, render: (mac, c) => templates.macro(mac as DoxygenMacro, c), getName: (mac) => (mac as DoxygenMacro).name, getLocation: (mac) => (mac as DoxygenMacro).location });
  }

  specs.push({ title: `${p}${titlePrefix ? "Members" : "Variables"}`, kind: "variable", items: members.variables, render: (v, c) => templates.variable(v as DoxygenVariable, c), getName: (v) => (v as DoxygenVariable).name, getLocation: (v) => (v as DoxygenVariable).location });

  /** Build source info object for a member if source URL is configured */
  function buildSourceInfo(item: unknown, spec: SectionSpec<unknown>): { file: string; line: number; url: string } | undefined {
    if (!options?.sourceUrlBase || !spec.getLocation) return undefined;
    const loc = spec.getLocation(item);
    if (!loc) return undefined;
    return { file: loc.file, line: loc.line, url: `${options.sourceUrlBase}/${loc.file}#L${loc.line}` };
  }

  /** Wrap rendered content with memberWrapper (passing source info as props) or append inline sourceLink */
  function wrapMember(rendered: string, spec: SectionSpec<unknown>, item: unknown): string {
    const sourceInfo = buildSourceInfo(item, spec);
    if (templates.memberWrapper) {
      return templates.memberWrapper(spec.kind, spec.getName(item), rendered, sourceInfo);
    }
    // Markdown fallback: append source link inline
    if (sourceInfo && templates.sourceLink) {
      const loc = spec.getLocation!(item)!;
      const sourceLink = templates.sourceLink(loc, options!.sourceUrlBase!);
      const sepIdx = rendered.lastIndexOf("\n---\n");
      if (sepIdx >= 0) {
        return rendered.substring(0, sepIdx) + "\n" + sourceLink + "\n\n---\n";
      }
      return rendered + "\n" + sourceLink + "\n";
    }
    return rendered;
  }

  const sections: string[] = [];
  for (const spec of specs) {
    if (spec.items.length === 0) continue;

    // Auto-group functions into Setters/Getters/Other when enabled
    if (
      spec.kind === "function" &&
      options?.autoGroupFunctions &&
      templates.functionGroupTabs
    ) {
      const grouped: Record<string, string[]> = { Setters: [], Getters: [], Other: [] };
      for (const item of spec.items) {
        const fn = item as DoxygenFunction;
        let rendered = spec.render(item, ctx);
        rendered = wrapMember(rendered, spec, item);
        grouped[classifyFunction(fn.name)].push(rendered);
      }

      const nonEmpty = (["Setters", "Getters", "Other"] as const).filter(
        (k) => grouped[k].length > 0,
      );

      // Skip grouping if only one category
      if (nonEmpty.length > 1) {
        sections.push(templates.sectionHeading(spec.title, 2));
        sections.push("");
        const groups: FunctionGroup[] = nonEmpty.map((label) => ({
          label: `${label} (${grouped[label].length})`,
          rendered: grouped[label],
        }));
        sections.push(templates.functionGroupTabs(groups, ctx));
        continue;
      }
    }

    // Default flat rendering
    sections.push(templates.sectionHeading(spec.title, 2));
    sections.push("");
    for (const item of spec.items) {
      let rendered = spec.render(item, ctx);
      rendered = wrapMember(rendered, spec, item);
      sections.push(rendered);

      // TypeUsedBy after enum/struct/typedef members
      if (spec.kind === "enum" || spec.kind === "struct" || spec.kind === "typedef") {
        const usedBy = renderTypeUsedBy(spec.getName(item), templates, ctx.analysis);
        if (usedBy) {
          sections.push(usedBy);
          sections.push("");
        }
      }
    }
  }
  return sections;
}

/**
 * Render member sections, with optional member group support.
 * If members have group tags and the template supports memberGroupHeading,
 * renders grouped members under group headings first, then ungrouped members
 * in the standard category sections.
 */
function renderMemberSectionsWithGroups(
  templates: TemplateSet,
  ctx: RenderContext,
  members: {
    functions: DoxygenFunction[];
    enums: DoxygenEnum[];
    structs: DoxygenStruct[];
    typedefs: DoxygenTypedef[];
    macros?: DoxygenMacro[];
    variables: DoxygenVariable[];
    memberGroups?: MemberGroup[];
  },
  options?: RenderOptions,
): string[] {
  const groups = members.memberGroups ?? [];

  // If no groups or template doesn't support group headings, use standard rendering
  if (groups.length === 0 || !templates.memberGroupHeading) {
    return renderMemberSections(templates, ctx, members, undefined, options);
  }

  const sections: string[] = [];

  // Render grouped members first
  for (const group of groups) {
    const groupFns = members.functions.filter(m => m.group === group.header);
    const groupEnums = members.enums.filter(m => m.group === group.header);
    const groupStructs = members.structs.filter(m => m.group === group.header);
    const groupTypedefs = members.typedefs.filter(m => m.group === group.header);
    const groupMacros = members.macros?.filter(m => m.group === group.header);
    const groupVars = members.variables.filter(m => m.group === group.header);

    const hasMembers = groupFns.length > 0 || groupEnums.length > 0 ||
      groupStructs.length > 0 || groupTypedefs.length > 0 ||
      (groupMacros?.length ?? 0) > 0 || groupVars.length > 0;

    if (hasMembers) {
      if (templates.memberGroupStart) {
        sections.push(templates.memberGroupStart(group));
        sections.push("");
      }
      sections.push(templates.memberGroupHeading(group));
      sections.push("");
      const groupSections = renderMemberSections(templates, ctx, {
        functions: groupFns,
        enums: groupEnums,
        structs: groupStructs,
        typedefs: groupTypedefs,
        macros: groupMacros,
        variables: groupVars,
      }, undefined, options);
      sections.push(...groupSections);
      if (templates.memberGroupEnd) {
        sections.push(templates.memberGroupEnd());
        sections.push("");
      }
    }
  }

  // Render ungrouped members
  const ungroupedFns = members.functions.filter(m => !m.group);
  const ungroupedEnums = members.enums.filter(m => !m.group);
  const ungroupedStructs = members.structs.filter(m => !m.group);
  const ungroupedTypedefs = members.typedefs.filter(m => !m.group);
  const ungroupedMacros = members.macros?.filter(m => !m.group);
  const ungroupedVars = members.variables.filter(m => !m.group);

  const ungroupedSections = renderMemberSections(templates, ctx, {
    functions: ungroupedFns,
    enums: ungroupedEnums,
    structs: ungroupedStructs,
    typedefs: ungroupedTypedefs,
    macros: ungroupedMacros,
    variables: ungroupedVars,
  }, undefined, options);
  sections.push(...ungroupedSections);

  return sections;
}

// ── Individual compound renderers ──

function renderFile(
  file: DoxygenFile,
  templates: TemplateSet,
  parseResult: ParseResult,
  analysis: AnalysisResult,
  options?: RenderOptions,
): RenderedFile | null {
  const ctx: RenderContext = {
    file,
    index: parseResult.index,
    analysis,
  };

  const sections: string[] = [];

  // Related headers banner (public <-> private)
  if (templates.relatedHeaders) {
    const pairedPath = analysis.privateHeaderPairs.get(file.name);
    if (pairedPath) {
      const isPrivate = file.name.includes("_private");
      sections.push(templates.relatedHeaders(file.name, pairedPath, isPrivate));
      sections.push("");
    }
  }

  // API summary
  if (templates.apiSummary) {
    const counts = computeApiCounts(file);
    const total = counts.functions + counts.enums + counts.structs + counts.typedefs + counts.macros + counts.variables;
    if (total > 0) {
      sections.push(templates.apiSummary(counts));
      sections.push("");
    }
  }

  // Member group headings + grouped members, then ungrouped
  const memberSections = renderMemberSectionsWithGroups(templates, ctx, file, options);
  sections.push(...memberSections);

  // Include dependency lists at the end of the page
  if (templates.includesList) {
    const transitiveIncludes = analysis.transitiveIncludes.get(file.name);
    const includesSection = templates.includesList(file.includes, file.includedby, transitiveIncludes);
    if (includesSection) {
      sections.push(includesSection);
    }
  }

  if (sections.length === 0) return null;

  const renderedSections = sections.join("\n");
  const content = templates.page(file, renderedSections);
  const pagePath = filePathToPagePath(file.path);
  const path = pagePath + templates.extension;

  return { path, content };
}

function makeCtx(
  compound: { name: string; compoundId: string; path: string; brief: string; description: string },
  parseResult: ParseResult,
  analysis?: AnalysisResult,
): RenderContext {
  return {
    file: {
      kind: "file",
      name: compound.name,
      compoundId: compound.compoundId,
      path: compound.path,
      brief: compound.brief,
      description: compound.description,
      functions: [],
      enums: [],
      structs: [],
      typedefs: [],
      macros: [],
      variables: [],
      includes: [],
      includedby: [],
      memberGroups: [],
    },
    index: parseResult.index,
    analysis,
  };
}

function renderClass(
  cls: DoxygenClassCompound,
  templates: TemplateSet,
  parseResult: ParseResult,
  analysis: AnalysisResult,
): RenderedFile | null {
  const ctx = makeCtx(cls, parseResult, analysis);

  const sections: string[] = [];

  for (const section of cls.accessSections) {
    const accessLabel =
      section.access.charAt(0).toUpperCase() + section.access.slice(1);

    const memberSections = renderMemberSections(
      templates,
      ctx,
      { functions: section.functions, enums: section.enums, structs: [], typedefs: section.typedefs, variables: section.variables },
      accessLabel,
    );
    sections.push(...memberSections);
  }

  if (cls.friends.length > 0) {
    sections.push(templates.sectionHeading("Friends", 2));
    sections.push("");
    for (const f of cls.friends) {
      let rendered = templates.friend(f, ctx);
      if (templates.memberWrapper) {
        rendered = templates.memberWrapper("friend", f.name, rendered);
      }
      sections.push(rendered);
    }
  }

  if (sections.length === 0) return null;

  const renderedSections = sections.join("\n");
  const content = templates.classPage(cls, renderedSections, ctx);
  const pagePath = filePathToPagePath(cls.path);
  const path = pagePath + templates.extension;

  return { path, content };
}

function renderNamespace(
  ns: DoxygenNamespaceCompound,
  templates: TemplateSet,
  parseResult: ParseResult,
  analysis: AnalysisResult,
  options?: RenderOptions,
): RenderedFile | null {
  const ctx = makeCtx(ns, parseResult, analysis);

  const sections = renderMemberSections(templates, ctx, ns, undefined, options);

  if (sections.length === 0) return null;

  const renderedSections = sections.join("\n");
  const content = templates.namespacePage(ns, renderedSections, ctx);
  const pagePath = filePathToPagePath(ns.path);
  const path = pagePath + templates.extension;

  return { path, content };
}

function renderGroup(
  group: DoxygenGroupCompound,
  templates: TemplateSet,
  parseResult: ParseResult,
  analysis: AnalysisResult,
  options?: RenderOptions,
): RenderedFile | null {
  const ctx = makeCtx(group, parseResult, analysis);

  const sections = renderMemberSections(templates, ctx, group, undefined, options);

  // Groups can have empty sections (only subgroups) — still render
  const renderedSections = sections.join("\n");
  const content = templates.groupPage(group, renderedSections, ctx);
  const pagePath = filePathToPagePath(group.path);
  const path = pagePath + templates.extension;

  return { path, content };
}

function renderPage(
  page: DoxygenPageCompound,
  templates: TemplateSet,
): RenderedFile {
  const content = templates.docsPage(page);
  const pagePath = filePathToPagePath(page.path);
  const path = pagePath + templates.extension;
  return { path, content };
}
