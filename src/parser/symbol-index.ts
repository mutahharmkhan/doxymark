import type {
  DoxygenCompound,
  DoxygenFile,
  DoxygenClassCompound,
  DoxygenNamespaceCompound,
  DoxygenGroupCompound,
  DoxygenPageCompound,
  DoxygenFunction,
  DoxygenEnum,
  DoxygenStruct,
  DoxygenTypedef,
  DoxygenMacro,
  DoxygenVariable,
  SymbolIndex,
  SymbolIndexEntry,
  SymbolRef,
  TypeRef,
  IncludeRef,
} from "./types.js";
import type { WarningCollector } from "./warnings.js";
import { filePathToPagePath } from "./utils.js";

export interface BuildSymbolIndexResult {
  index: SymbolIndex;
  refidMap: Record<string, string>;
}

type SetIndex = (name: string, entry: SymbolIndexEntry) => void;

// ── Shared indexing helper ──

interface MembersList {
  functions: DoxygenFunction[];
  enums: DoxygenEnum[];
  structs: DoxygenStruct[];
  typedefs: DoxygenTypedef[];
  macros?: DoxygenMacro[];
  variables: DoxygenVariable[];
}

function indexMembersList(
  members: MembersList,
  pagePath: string,
  setIndex: SetIndex,
  refidMap: Record<string, string>,
  prefix?: string,
): void {
  const q = (name: string) => prefix ? `${prefix}::${name}` : name;

  for (const fn of members.functions) {
    setIndex(q(fn.name), { path: pagePath, anchor: fn.name, kind: "function" });
    if (fn.id) refidMap[fn.id] = `${pagePath}#${fn.name}`;
  }

  for (const en of members.enums) {
    setIndex(q(en.name), { path: pagePath, anchor: en.name, kind: "enum" });
    if (en.id) refidMap[en.id] = `${pagePath}#${en.name}`;
    for (const val of en.values) {
      setIndex(q(val.name), { path: pagePath, anchor: en.name, kind: "enumvalue" });
      if (val.id) refidMap[val.id] = `${pagePath}#${en.name}`;
    }
  }

  for (const st of members.structs) {
    setIndex(q(st.name), { path: pagePath, anchor: st.name, kind: "struct" });
    if (st.id) refidMap[st.id] = `${pagePath}#${st.name}`;
    for (const fn of st.functions) {
      setIndex(`${q(st.name)}::${fn.name}`, { path: pagePath, anchor: fn.name, kind: "function" });
      if (fn.id) refidMap[fn.id] = `${pagePath}#${fn.name}`;
    }
  }

  for (const td of members.typedefs) {
    setIndex(q(td.name), { path: pagePath, anchor: td.name, kind: "typedef" });
    if (td.id) refidMap[td.id] = `${pagePath}#${td.name}`;
  }

  if (members.macros) {
    for (const mac of members.macros) {
      setIndex(q(mac.name), { path: pagePath, anchor: mac.name, kind: "macro" });
      if (mac.id) refidMap[mac.id] = `${pagePath}#${mac.name}`;
    }
  }

  for (const v of members.variables) {
    setIndex(q(v.name), { path: pagePath, anchor: v.name, kind: "variable" });
    if (v.id) refidMap[v.id] = `${pagePath}#${v.name}`;
  }
}

// ── Shared ref resolution helpers ──

function resolveFunctionRefs(fn: DoxygenFunction, index: SymbolIndex): void {
  resolveTypeRefRefs(fn.returnType, index);
  for (const param of fn.params) {
    resolveTypeRefRefs(param.type, index);
  }
  if (fn.templateParams) {
    for (const tp of fn.templateParams) {
      resolveTypeRefRefs(tp.type, index);
    }
  }
}

function resolveMemberListRefs(members: MembersList, index: SymbolIndex): void {
  for (const fn of members.functions) {
    resolveFunctionRefs(fn, index);
  }
  for (const st of members.structs) {
    for (const member of st.members) {
      resolveTypeRefRefs(member.type, index);
    }
    for (const fn of st.functions) {
      resolveFunctionRefs(fn, index);
    }
  }
  for (const td of members.typedefs) {
    resolveTypeRefRefs(td.type, index);
  }
  for (const v of members.variables) {
    resolveTypeRefRefs(v.type, index);
  }
}

function resolveTypeRefRefs(typeRef: TypeRef, index: SymbolIndex): void {
  for (const ref of typeRef.refs) {
    resolveSymbolRef(ref, index);
  }
}

function resolveSymbolRef(ref: SymbolRef, index: SymbolIndex): void {
  if (ref.path) return;
  const entry = index[ref.name];
  if (entry) {
    ref.path = entry.path + "#" + entry.anchor;
  }
}

// ── Shared description resolution helpers ──

type ResolveFn = (s: string) => string;

function resolveStringField(value: string | undefined, resolve: ResolveFn): string | undefined {
  return value ? resolve(value) : value;
}

function resolveAdditionalSections(sections: Record<string, string[]>, resolve: ResolveFn): void {
  for (const [key, values] of Object.entries(sections)) {
    sections[key] = values.map(resolve);
  }
}

function resolveFunctionDescriptions(fn: DoxygenFunction, resolve: ResolveFn): void {
  fn.brief = resolve(fn.brief);
  fn.description = resolve(fn.description);
  fn.returnDescription = resolve(fn.returnDescription);
  fn.inbodyDescription = resolveStringField(fn.inbodyDescription, resolve);
  fn.deprecated = resolveStringField(fn.deprecated, resolve);
  fn.since = resolveStringField(fn.since, resolve);
  fn.notes = fn.notes.map(resolve);
  fn.warnings = fn.warnings.map(resolve);
  fn.seeAlso = fn.seeAlso.map(resolve);
  for (const param of fn.params) {
    param.description = resolve(param.description);
  }
  if (fn.templateParams) {
    for (const tp of fn.templateParams) {
      tp.description = resolve(tp.description);
    }
  }
  resolveAdditionalSections(fn.additionalSections, resolve);
  for (const [key, val] of fn.retvalDescriptions) {
    fn.retvalDescriptions.set(key, resolve(val));
  }
  for (const [key, val] of fn.exceptions) {
    fn.exceptions.set(key, resolve(val));
  }
}

function resolveEnumDescriptions(en: DoxygenEnum, resolve: ResolveFn): void {
  en.brief = resolve(en.brief);
  en.description = resolve(en.description);
  for (const val of en.values) {
    val.brief = resolve(val.brief);
    val.description = resolve(val.description);
  }
  resolveAdditionalSections(en.additionalSections, resolve);
}

function resolveStructDescriptions(st: DoxygenStruct, resolve: ResolveFn): void {
  st.brief = resolve(st.brief);
  st.description = resolve(st.description);
  for (const member of st.members) {
    member.brief = resolve(member.brief);
    member.description = resolve(member.description);
  }
  for (const fn of st.functions) {
    resolveFunctionDescriptions(fn, resolve);
  }
  resolveAdditionalSections(st.additionalSections, resolve);
}

/** Resolve descriptions for members that have brief + description + additionalSections. */
function resolveBasicMemberDescriptions(
  member: { brief: string; description: string; additionalSections: Record<string, string[]> },
  resolve: ResolveFn,
): void {
  member.brief = resolve(member.brief);
  member.description = resolve(member.description);
  resolveAdditionalSections(member.additionalSections, resolve);
}

function resolveMacroDescriptions(mac: DoxygenMacro, resolve: ResolveFn): void {
  mac.brief = resolve(mac.brief);
  mac.description = resolve(mac.description);
  mac.returnDescription = resolveStringField(mac.returnDescription, resolve);
  mac.deprecated = resolveStringField(mac.deprecated, resolve);
  mac.since = resolveStringField(mac.since, resolve);
  if (mac.seeAlso) mac.seeAlso = mac.seeAlso.map(resolve);
  if (mac.notes) mac.notes = mac.notes.map(resolve);
  if (mac.warnings) mac.warnings = mac.warnings.map(resolve);
  if (mac.paramDescriptions) {
    for (const [key, val] of mac.paramDescriptions) {
      mac.paramDescriptions.set(key, resolve(val));
    }
  }
  if (mac.retvalDescriptions) {
    for (const [key, val] of mac.retvalDescriptions) {
      mac.retvalDescriptions.set(key, resolve(val));
    }
  }
  resolveAdditionalSections(mac.additionalSections, resolve);
}

function resolveMembersDescriptions(members: MembersList, resolve: ResolveFn): void {
  for (const fn of members.functions) resolveFunctionDescriptions(fn, resolve);
  for (const en of members.enums) resolveEnumDescriptions(en, resolve);
  for (const st of members.structs) resolveStructDescriptions(st, resolve);
  for (const td of members.typedefs) resolveBasicMemberDescriptions(td, resolve);
  if (members.macros) {
    for (const mac of members.macros) resolveMacroDescriptions(mac, resolve);
  }
  for (const v of members.variables) resolveBasicMemberDescriptions(v, resolve);
}

// ── Build symbol index ──

/**
 * Build a symbol index from all parsed compounds.
 * Maps symbol names to their page path + anchor.
 * Also builds a refidMap that maps member ids to "pagePath#anchor".
 */
export function buildSymbolIndex(compounds: DoxygenCompound[], collector: WarningCollector): BuildSymbolIndexResult {
  const index: SymbolIndex = {};
  const refidMap: Record<string, string> = {};

  const setIndex = (name: string, entry: SymbolIndexEntry): void => {
    const existing = index[name];
    if (existing) {
      collector.warn(
        `Duplicate symbol "${name}" (${entry.kind} at ${entry.path}) overwrites previous (${existing.kind} at ${existing.path})`,
      );
    }
    index[name] = entry;
  };

  for (const compound of compounds) {
    switch (compound.kind) {
      case "file":
        indexFileCompound(compound, refidMap, setIndex);
        break;
      case "class":
        indexClassCompound(compound, index, refidMap, setIndex);
        break;
      case "namespace":
        indexNamespaceCompound(compound, index, refidMap, setIndex);
        break;
      case "group":
        indexGroupCompound(compound, refidMap, setIndex);
        break;
      case "page":
        indexPageCompound(compound, refidMap, setIndex);
        break;
    }
  }

  return { index, refidMap };
}

function indexFileCompound(file: DoxygenFile, refidMap: Record<string, string>, setIndex: SetIndex): void {
  const pagePath = filePathToPagePath(file.path);
  setIndex(file.name, { path: pagePath, anchor: "", kind: "header" });
  refidMap[file.compoundId] = pagePath;
  indexMembersList(file, pagePath, setIndex, refidMap);
}

function indexClassCompound(cls: DoxygenClassCompound, index: SymbolIndex, refidMap: Record<string, string>, setIndex: SetIndex): void {
  const pagePath = filePathToPagePath(cls.path);

  setIndex(cls.name, { path: pagePath, anchor: cls.name, kind: "class" });
  refidMap[cls.compoundId] = pagePath;

  for (const section of cls.accessSections) {
    for (const fn of section.functions) {
      setIndex(`${cls.name}::${fn.name}`, { path: pagePath, anchor: fn.name, kind: "function" });
      if (fn.id) refidMap[fn.id] = `${pagePath}#${fn.name}`;
      if (!index[fn.name]) {
        setIndex(fn.name, { path: pagePath, anchor: fn.name, kind: "function" });
      }
    }

    for (const v of section.variables) {
      setIndex(`${cls.name}::${v.name}`, { path: pagePath, anchor: v.name, kind: "variable" });
      if (v.id) refidMap[v.id] = `${pagePath}#${v.name}`;
    }

    for (const td of section.typedefs) {
      setIndex(`${cls.name}::${td.name}`, { path: pagePath, anchor: td.name, kind: "typedef" });
      if (td.id) refidMap[td.id] = `${pagePath}#${td.name}`;
    }

    for (const en of section.enums) {
      setIndex(`${cls.name}::${en.name}`, { path: pagePath, anchor: en.name, kind: "enum" });
      if (en.id) refidMap[en.id] = `${pagePath}#${en.name}`;
      for (const val of en.values) {
        setIndex(`${cls.name}::${val.name}`, { path: pagePath, anchor: en.name, kind: "enumvalue" });
        if (val.id) refidMap[val.id] = `${pagePath}#${en.name}`;
      }
    }

  }
}

function indexNamespaceCompound(ns: DoxygenNamespaceCompound, index: SymbolIndex, refidMap: Record<string, string>, setIndex: SetIndex): void {
  const pagePath = filePathToPagePath(ns.path);

  setIndex(ns.name, { path: pagePath, anchor: ns.name, kind: "namespace" });
  refidMap[ns.compoundId] = pagePath;

  // Functions get both qualified and unqualified names
  for (const fn of ns.functions) {
    setIndex(`${ns.name}::${fn.name}`, { path: pagePath, anchor: fn.name, kind: "function" });
    if (fn.id) refidMap[fn.id] = `${pagePath}#${fn.name}`;
    if (!index[fn.name]) {
      setIndex(fn.name, { path: pagePath, anchor: fn.name, kind: "function" });
    }
  }

  // Remaining members use the shared helper with prefix
  indexMembersList(
    { functions: [], enums: ns.enums, structs: ns.structs, typedefs: ns.typedefs, variables: ns.variables },
    pagePath, setIndex, refidMap, ns.name,
  );
}

function indexGroupCompound(group: DoxygenGroupCompound, refidMap: Record<string, string>, setIndex: SetIndex): void {
  const pagePath = filePathToPagePath(group.path);
  refidMap[group.compoundId] = pagePath;
  indexMembersList(group, pagePath, setIndex, refidMap);
}

function indexPageCompound(page: DoxygenPageCompound, refidMap: Record<string, string>, setIndex: SetIndex): void {
  const pagePath = filePathToPagePath(page.path);
  refidMap[page.compoundId] = pagePath;
  setIndex(page.name, { path: pagePath, anchor: page.name, kind: "page" });
}

// ── Resolve type refs ──

/**
 * Resolve all SymbolRef.path fields throughout the IR using the symbol index.
 */
function resolveIncludeRefs(includes: IncludeRef[], refidMap: Record<string, string>): void {
  for (const inc of includes) {
    if (inc.refid && !inc.path) {
      const resolved = refidMap[inc.refid];
      if (resolved) inc.path = resolved;
    }
  }
}

export function resolveRefs(compounds: DoxygenCompound[], index: SymbolIndex, refidMap?: Record<string, string>): void {
  for (const compound of compounds) {
    switch (compound.kind) {
      case "file":
        resolveMemberListRefs(compound, index);
        if (refidMap) {
          resolveIncludeRefs(compound.includes, refidMap);
          resolveIncludeRefs(compound.includedby, refidMap);
        }
        break;
      case "class":
        for (const section of compound.accessSections) {
          for (const fn of section.functions) resolveFunctionRefs(fn, index);
          for (const v of section.variables) resolveTypeRefRefs(v.type, index);
          for (const td of section.typedefs) resolveTypeRefRefs(td.type, index);
        }
        for (const f of compound.friends) resolveTypeRefRefs(f.type, index);
        break;
      case "namespace":
        resolveMemberListRefs(compound, index);
        break;
      case "group":
        resolveMemberListRefs(compound, index);
        break;
      case "page":
        break;
    }
  }
}

// ── Resolve description refs ──

/**
 * Resolve {{dxref:...}} markers in all description strings throughout the IR.
 * Outputs {{dxlink:display|path}} placeholders that the renderer resolves
 * using a template-specific method (e.g. markdown link vs <ApiLink>).
 */
export function resolveDescriptionRefs(
  compounds: DoxygenCompound[],
  refidMap: Record<string, string>,
): void {
  const resolve = (s: string): string => {
    return s.replace(
      /\[([^\]]+)\]\(\{\{dxref:([^}]+)\}\}\)/g,
      (_match, display, refid) => {
        const path = refidMap[refid];
        if (!path) return display.replace(/^`|`$/g, "");
        // Strip backticks from display — template controls formatting
        const cleanDisplay = display.replace(/^`|`$/g, "");
        return `{{dxlink:${cleanDisplay}|${path}}}`;
      },
    );
  };

  for (const compound of compounds) {
    resolveCompoundDescriptions(compound, resolve);
  }
}

function resolveCompoundDescriptions(compound: DoxygenCompound, resolve: ResolveFn): void {
  compound.brief = resolve(compound.brief);
  compound.description = resolve(compound.description);

  switch (compound.kind) {
    case "file":
      resolveMembersDescriptions(compound, resolve);
      break;
    case "class":
      resolveAdditionalSections(compound.additionalSections, resolve);
      for (const section of compound.accessSections) {
        resolveMembersDescriptions(
          { functions: section.functions, enums: section.enums, structs: [], typedefs: section.typedefs, variables: section.variables },
          resolve,
        );
      }
      for (const f of compound.friends) {
        f.brief = resolve(f.brief);
        f.description = resolve(f.description);
      }
      break;
    case "namespace":
      resolveAdditionalSections(compound.additionalSections, resolve);
      resolveMembersDescriptions(compound, resolve);
      break;
    case "group":
      resolveAdditionalSections(compound.additionalSections, resolve);
      resolveMembersDescriptions(compound, resolve);
      break;
    case "page":
      break;
  }
}

// ── Validate refs ──

export interface ValidateRefsResult {
  unresolvedCount: number;
  unresolvedRefs: Array<{ name: string; refid: string }>;
}

function checkTypeRef(
  typeRef: TypeRef,
  result: ValidateRefsResult,
): void {
  for (const ref of typeRef.refs) {
    if (!ref.path) {
      result.unresolvedRefs.push({ name: ref.name, refid: ref.refid });
      result.unresolvedCount++;
    }
  }
}

function checkFunctionRefs(fn: DoxygenFunction, result: ValidateRefsResult): void {
  checkTypeRef(fn.returnType, result);
  for (const param of fn.params) checkTypeRef(param.type, result);
  if (fn.templateParams) {
    for (const tp of fn.templateParams) checkTypeRef(tp.type, result);
  }
}

function checkMemberListRefs(members: MembersList, result: ValidateRefsResult): void {
  for (const fn of members.functions) checkFunctionRefs(fn, result);
  for (const st of members.structs) {
    for (const member of st.members) checkTypeRef(member.type, result);
    for (const fn of st.functions) checkFunctionRefs(fn, result);
  }
  for (const td of members.typedefs) checkTypeRef(td.type, result);
  for (const v of members.variables) checkTypeRef(v.type, result);
}

/**
 * Validate that all type refs in all compounds have been resolved.
 */
export function validateRefs(compounds: DoxygenCompound[]): ValidateRefsResult {
  const result: ValidateRefsResult = { unresolvedCount: 0, unresolvedRefs: [] };

  for (const compound of compounds) {
    switch (compound.kind) {
      case "file":
        checkMemberListRefs(compound, result);
        break;
      case "class":
        for (const section of compound.accessSections) {
          for (const fn of section.functions) checkFunctionRefs(fn, result);
          for (const v of section.variables) checkTypeRef(v.type, result);
          for (const td of section.typedefs) checkTypeRef(td.type, result);
        }
        for (const f of compound.friends) checkTypeRef(f.type, result);
        break;
      case "namespace":
        checkMemberListRefs(compound, result);
        break;
      case "group":
        checkMemberListRefs(compound, result);
        break;
      case "page":
        break;
    }
  }

  return result;
}
