import type {
  DoxygenFile,
  DoxygenFunction,
  DoxygenEnum,
  DoxygenStruct,
  DoxygenMacro,
  DoxygenTypedef,
  DoxygenVariable,
  DoxygenClassCompound,
  DoxygenNamespaceCompound,
  DoxygenGroupCompound,
  DoxygenPageCompound,
  SymbolRef,
  IncludeRef,
  SourceLocation,
  MemberGroup,
} from "../../parser/types.js";
import type { TypeUsageEntry } from "../../analyzer/types.js";
import type { TemplateSet, RenderContext, FunctionGroup, DirectoryEntry, DirectoryIndexEntry, DirectoryIndexContext, ApiCounts, RenderedFile } from "../types.js";
import {
  markdownTemplates,
  renderDescription,
  formatTypeRef,
  formatSignature,
  hasCppAttributes,
  renderMacroDefinition,
  cleanAnonymousTypes,
  escapePipesOutsideCode,
} from "../templates/markdown.js";

/** Quote a YAML value if it contains special characters. */
function yamlQuote(value: string): string {
  if (/[:#<>&*!|>{}'"\[\],@`]/.test(value) || value.startsWith("-") || value.startsWith("?")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Write YAML frontmatter block. */
function writeFrontmatter(parts: string[], title: string, description: string): void {
  parts.push("---");
  parts.push(`title: ${yamlQuote(title)}`);
  parts.push(`description: ${yamlQuote(description)}`);
  parts.push("---");
  parts.push("");
}

/** Capitalize first letter of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert underscore-separated name to Title Case: "draw_sw_blend" → "Draw Sw Blend" */
function titleCase(s: string): string {
  return s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Escape characters that break MDX parsing in prose text.
 * Preserves content inside code fences, matched inline code spans,
 * and internal {{...}} placeholders (e.g. {{dxanchor:id}}).
 * - Bare { } are treated as JS expressions by MDX
 * - Bare < that doesn't start a valid HTML/JSX tag is treated as JSX
 * - Bare > is escaped for symmetry with < so patterns like <X> render consistently
 */
export function escapeMdxText(text: string): string {
  if (!text || !/[{}<>`]/.test(text)) return text;

  const result: string[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // Code fence: preserve ```...``` blocks
    if (ch === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
      const start = i;
      i += 3;
      while (i < len) {
        if (text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
          i += 3;
          break;
        }
        i++;
      }
      result.push(text.substring(start, i));
      continue;
    }

    // Inline code: preserve `...` spans (only if there is a closing backtick)
    if (ch === '`') {
      const closeIdx = text.indexOf('`', i + 1);
      if (closeIdx >= 0) {
        result.push(text.substring(i, closeIdx + 1));
        i = closeIdx + 1;
        continue;
      }
      // Unmatched backtick — treat as literal and keep escaping rest of string
      result.push(ch);
      i++;
      continue;
    }

    // Double-brace placeholders like {{dxanchor:...}} — preserve
    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      if (end >= 0) {
        result.push(text.substring(i, end + 2));
        i = end + 2;
        continue;
      }
    }

    // Bare { or } — escape for MDX
    if (ch === '{' || ch === '}') {
      result.push('\\' + ch);
      i++;
      continue;
    }

    // Bare < — always escape in description text.
    // Any intentional JSX components (ApiLink, Callout, etc.) are added
    // outside of escapeMdxText, so all < in description text is literal.
    if (ch === '<') {
      result.push('\\<');
      i++;
      continue;
    }

    // Bare > — escape for symmetry. Prevents half-escaped patterns like
    // "\<widget_type>_#" where < is escaped but > leaks through.
    if (ch === '>') {
      result.push('\\>');
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

/** Shorthand alias for escapeMdxText. */
const esc = escapeMdxText;

/**
 * Sanitize description text for inclusion in an MDX table cell. Handles:
 * fenced code blocks → inline code, MDX escaping of < { }, pipe escaping
 * outside code spans, and newlines → <br/>.
 */
export function sanitizeForMdxTableCell(text: string): string {
  if (!text) return "";
  // Convert fenced code blocks to inline code (table cells can't hold block code)
  let result = text.replace(/\n?```\w*\n([\s\S]*?)\n```\n?/g, (_, code) => {
    return " `" + code.trim().replace(/\n/g, " ") + "` ";
  });
  // MDX-escape bare <, {, } in text portions (preserves code spans and {{placeholders}})
  result = escapeMdxText(result);
  // Escape unescaped pipes outside of code spans so they don't split cells
  result = escapePipesOutsideCode(result);
  // Replace remaining newlines with <br/> so the row stays on one line
  result = result.replace(/\n/g, "<br/>");
  return result.trim();
}

/** Map Doxygen additional section kinds to Callout types. */
function calloutType(sectionKind: string): "info" | "warn" | "error" {
  switch (sectionKind) {
    case "attention":
    case "important":
      return "warn";
    default:
      return "info";
  }
}

/** Render a Callout component. */
function renderCallout(type: "info" | "warn" | "error", content: string): string {
  return `<Callout type="${type}">\n${content}\n</Callout>`;
}

/** Render additionalSections as Callout components. */
function renderCalloutSections(
  sections: Record<string, string[]>,
  parts: string[],
): void {
  for (const [key, values] of Object.entries(sections)) {
    const type = calloutType(key);
    for (const value of values) {
      parts.push(renderCallout(type, `**${capitalize(key)}:** ${esc(value)}`));
      parts.push("");
    }
  }
}

/**
 * Fumadocs preset — overrides page and member methods for MDX output
 * with Callout components and unsanitized table cells.
 */
export const fumadocsPreset: TemplateSet = {
  ...markdownTemplates,

  extension: ".mdx",

  page(file: DoxygenFile, renderedSections: string): string {
    const parts: string[] = [];
    parts.push("---");
    parts.push(`title: ${yamlQuote(file.name)}`);
    parts.push(`description: ${yamlQuote(`API reference for ${file.name}`)}`);

    const api: Record<string, string[]> = {};
    if (file.functions.length > 0) api.functions = file.functions.map(f => f.name);
    if (file.enums.length > 0) api.enums = file.enums.map(e => e.name);
    if (file.structs.length > 0) api.structs = file.structs.map(s => s.name);
    if (file.typedefs.length > 0) api.typedefs = file.typedefs.map(t => t.name);
    if (file.macros.length > 0) api.macros = file.macros.map(m => m.name);
    if (file.variables.length > 0) api.variables = file.variables.map(v => v.name);

    if (Object.keys(api).length > 0) {
      parts.push("api:");
      for (const [key, names] of Object.entries(api)) {
        parts.push(`  ${key}: [${names.map(n => yamlQuote(n)).join(", ")}]`);
      }
    }

    parts.push("---");
    parts.push("");

    const brief = file.brief;
    const description = file.description;
    if (brief) {
      parts.push(esc(brief));
      parts.push("");
    }
    if (description && description !== brief) {
      parts.push(esc(description));
      parts.push("");
    }

    parts.push(renderedSections);

    return parts.join("\n");
  },

  function(fn: DoxygenFunction, ctx: RenderContext): string {
    const parts: string[] = [];

    const desc = esc(renderDescription(fn.brief, fn.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (fn.inbodyDescription) {
      parts.push(esc(fn.inbodyDescription));
      parts.push("");
    }

    parts.push(hasCppAttributes(fn) ? "```cpp" : "```c");
    parts.push(formatSignature(fn));
    parts.push("```");
    parts.push("");

    if (fn.params.length > 0) {
      const hasAnyParamDesc = fn.params.some((p) => !!p.description);
      parts.push('<span className="sr-only">Parameters</span>');
      parts.push("");
      if (hasAnyParamDesc) {
        parts.push("| Name | Type | Description |");
        parts.push("|------|------|-------------|");
      } else {
        parts.push("| Name | Type |");
        parts.push("|------|------|");
      }
      for (const param of fn.params) {
        const isVariadic = param.name === "..." || (param.type.text === "..." && !param.name);
        if (isVariadic) {
          const desc = sanitizeForMdxTableCell(param.description || "");
          parts.push(hasAnyParamDesc ? `| \`...\` | | ${desc} |` : `| \`...\` | |`);
          continue;
        }
        const dirPrefix = param.direction ? `**[${param.direction}]** ` : "";
        const typeText = formatTypeRef(param.type, this.symbolRef);
        const desc = sanitizeForMdxTableCell(param.description || "");
        parts.push(
          hasAnyParamDesc
            ? `| ${dirPrefix}\`${param.name}\` | ${typeText} | ${desc} |`
            : `| ${dirPrefix}\`${param.name}\` | ${typeText} |`,
        );
      }
      parts.push("");
    }

    if (fn.templateParams && fn.templateParams.length > 0) {
      parts.push("**Template Parameters:**");
      parts.push("");
      parts.push("| Name | Type | Description |");
      parts.push("|------|------|-------------|");
      for (const tp of fn.templateParams) {
        const nameCell = tp.name ? `\`${tp.name}\`` : "—";
        parts.push(`| ${nameCell} | \`${tp.type.text}\` | ${sanitizeForMdxTableCell(tp.description || "")} |`);
      }
      parts.push("");
    }

    if (fn.returnDescription && fn.returnType.text !== "void") {
      parts.push(
        `**Returns:** ${formatTypeRef(fn.returnType, this.symbolRef)} — ${esc(fn.returnDescription)}`,
      );
      parts.push("");
    }

    if (fn.retvalDescriptions.size > 0) {
      parts.push("**Return values:**");
      parts.push("");
      parts.push("| Value | Description |");
      parts.push("|-------|-------------|");
      for (const [val, desc] of fn.retvalDescriptions) {
        parts.push(`| \`${val}\` | ${sanitizeForMdxTableCell(desc)} |`);
      }
      parts.push("");
    }

    if (fn.exceptions.size > 0) {
      parts.push("**Exceptions:**");
      parts.push("");
      parts.push("| Exception | Description |");
      parts.push("|-----------|-------------|");
      for (const [exc, desc] of fn.exceptions) {
        parts.push(`| \`${exc}\` | ${sanitizeForMdxTableCell(desc)} |`);
      }
      parts.push("");
    }

    if (fn.notes.length > 0) {
      for (const note of fn.notes) {
        parts.push(renderCallout("info", esc(note)));
        parts.push("");
      }
    }

    if (fn.warnings.length > 0) {
      for (const warning of fn.warnings) {
        parts.push(renderCallout("warn", esc(warning)));
        parts.push("");
      }
    }

    if (fn.since) {
      parts.push(`**Since:** ${esc(fn.since)}`);
      parts.push("");
    }

    if (fn.deprecated) {
      parts.push(renderCallout("error", `**Deprecated:** ${esc(fn.deprecated)}`));
      parts.push("");
    }

    if (fn.seeAlso.length > 0) {
      parts.push("**See also:** " + fn.seeAlso.map(s => esc(s)).join(", "));
      parts.push("");
    }

    renderCalloutSections(fn.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  enum(en: DoxygenEnum, ctx: RenderContext): string {
    const parts: string[] = [];


    const desc = esc(renderDescription(en.brief, en.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (en.values.length > 0) {
      const hasAnyValue = en.values.some((v) => !!v.initializer);
      const hasAnyDesc = en.values.some((v) => !!(v.brief || v.description));

      const cols = ["Name"];
      if (hasAnyValue) cols.push("Value");
      if (hasAnyDesc) cols.push("Description");

      parts.push("| " + cols.join(" | ") + " |");
      parts.push("|" + cols.map(() => "------").join("|") + "|");
      for (const val of en.values) {
        const cells = [`\`${val.name}\``];
        if (hasAnyValue) cells.push(val.initializer ? `\`${val.initializer.replace(/^=\s*/, "").replace(/\|/g, "\\|")}\`` : "");
        if (hasAnyDesc) cells.push(sanitizeForMdxTableCell(val.brief || val.description || ""));
        parts.push("| " + cells.join(" | ") + " |");
      }
      parts.push("");
    }

    renderCalloutSections(en.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  struct(st: DoxygenStruct, ctx: RenderContext): string {
    const parts: string[] = [];


    const desc = esc(renderDescription(st.brief, st.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (st.members.length > 0) {
      parts.push("| Member | Type | Description |");
      parts.push("|--------|------|-------------|");
      for (const member of st.members) {
        const memberDesc = sanitizeForMdxTableCell(member.brief || member.description || "");
        const typeDisplay = member.argsstring
          ? `\`${cleanAnonymousTypes(member.type.text)}${member.argsstring}\``
          : formatTypeRef(member.type, this.symbolRef);
        parts.push(
          `| \`${member.name}\` | ${typeDisplay} | ${memberDesc} |`,
        );
      }
      parts.push("");
    }

    if (st.functions && st.functions.length > 0) {
      parts.push("**Methods:**");
      parts.push("");
      for (const fn of st.functions) {
        parts.push(this.function(fn, ctx));
      }
    }

    renderCalloutSections(st.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  macro(mac: DoxygenMacro, ctx: RenderContext): string {
    const parts: string[] = [];


    renderMacroDefinition(mac, parts);
    parts.push("");

    const desc = esc(renderDescription(mac.brief, mac.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (mac.params && mac.params.length > 0 && mac.paramDescriptions && mac.paramDescriptions.size > 0) {
      parts.push('<span className="sr-only">Parameters</span>');
      parts.push("");
      parts.push("| Name | Description |");
      parts.push("|------|-------------|");
      for (const param of mac.params) {
        const paramDesc = mac.paramDescriptions.get(param);
        parts.push(`| \`${param}\` | ${sanitizeForMdxTableCell(paramDesc || "")} |`);
      }
      parts.push("");
    }

    if (mac.returnDescription) {
      parts.push(`**Returns:** ${esc(mac.returnDescription)}`);
      parts.push("");
    }

    if (mac.retvalDescriptions && mac.retvalDescriptions.size > 0) {
      parts.push("**Return values:**");
      parts.push("");
      parts.push("| Value | Description |");
      parts.push("|-------|-------------|");
      for (const [val, retvalDesc] of mac.retvalDescriptions) {
        parts.push(`| \`${val}\` | ${sanitizeForMdxTableCell(retvalDesc)} |`);
      }
      parts.push("");
    }

    if (mac.notes && mac.notes.length > 0) {
      for (const note of mac.notes) {
        parts.push(renderCallout("info", esc(note)));
        parts.push("");
      }
    }

    if (mac.warnings && mac.warnings.length > 0) {
      for (const warning of mac.warnings) {
        parts.push(renderCallout("warn", esc(warning)));
        parts.push("");
      }
    }

    if (mac.since) {
      parts.push(`**Since:** ${esc(mac.since)}`);
      parts.push("");
    }

    if (mac.deprecated) {
      parts.push(renderCallout("error", `**Deprecated:** ${esc(mac.deprecated)}`));
      parts.push("");
    }

    if (mac.seeAlso && mac.seeAlso.length > 0) {
      parts.push("**See also:** " + mac.seeAlso.map(s => esc(s)).join(", "));
      parts.push("");
    }

    renderCalloutSections(mac.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  typedef(td: DoxygenTypedef, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push("```c");
    if (td.definition) {
      parts.push(td.definition);
    } else {
      parts.push(`typedef ${td.type.text} ${td.name}`);
    }
    parts.push("```");
    parts.push("");

    const desc = esc(renderDescription(td.brief, td.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    renderCalloutSections(td.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  variable(v: DoxygenVariable, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push("```c");
    parts.push(`${v.type.text} ${v.name}`);
    parts.push("```");
    parts.push("");

    const desc = esc(renderDescription(v.brief, v.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    renderCalloutSections(v.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  classPage(cls: DoxygenClassCompound, renderedSections: string, ctx: RenderContext): string {
    const parts: string[] = [];
    parts.push("---");
    parts.push(`title: ${yamlQuote(cls.name)}`);
    parts.push(`description: ${yamlQuote(`API reference for class ${cls.name}`)}`);

    const api: Record<string, string[]> = {};
    for (const section of cls.accessSections) {
      if (section.functions.length > 0) {
        api.functions = (api.functions || []).concat(section.functions.map(f => f.name));
      }
      if (section.enums.length > 0) {
        api.enums = (api.enums || []).concat(section.enums.map(e => e.name));
      }
      if (section.typedefs.length > 0) {
        api.typedefs = (api.typedefs || []).concat(section.typedefs.map(t => t.name));
      }
      if (section.variables.length > 0) {
        api.variables = (api.variables || []).concat(section.variables.map(v => v.name));
      }
    }
    if (cls.friends.length > 0) api.friends = cls.friends.map(f => f.name);

    if (Object.keys(api).length > 0) {
      parts.push("api:");
      for (const [key, names] of Object.entries(api)) {
        parts.push(`  ${key}: [${names.map(n => yamlQuote(n)).join(", ")}]`);
      }
    }

    parts.push("---");
    parts.push("");

    if (cls.templateParams && cls.templateParams.length > 0) {
      const tpStr = cls.templateParams
        .map((tp) => `${tp.type.text} ${tp.name}`.trim())
        .join(", ");
      parts.push("```cpp");
      parts.push(`template <${tpStr}>`);
      parts.push(`class ${cls.name}`);
      parts.push("```");
      parts.push("");
    }

    const desc = esc(renderDescription(cls.brief, cls.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (cls.baseClasses.length > 0) {
      const bases = cls.baseClasses.map((bc) => {
        const virt = bc.virtual ? "virtual " : "";
        const entry = bc.name ? ctx.index[bc.name] : undefined;
        const nameStr = entry
          ? `[${bc.name}](${entry.path}#${entry.anchor})`
          : bc.name;
        return `${virt}${bc.protection} ${nameStr}`;
      });
      parts.push(`**Inherits from:** ${bases.join(", ")}`);
      parts.push("");
    }

    if (cls.derivedClasses.length > 0) {
      const derived = cls.derivedClasses.map((dc) => {
        const entry = dc.name ? ctx.index[dc.name] : undefined;
        return entry
          ? `[${dc.name}](${entry.path}#${entry.anchor})`
          : dc.name;
      });
      parts.push(`**Derived classes:** ${derived.join(", ")}`);
      parts.push("");
    }

    renderCalloutSections(cls.additionalSections, parts);

    parts.push(renderedSections);

    return parts.join("\n");
  },

  namespacePage(ns: DoxygenNamespaceCompound, renderedSections: string, ctx: RenderContext): string {
    const parts: string[] = [];
    parts.push("---");
    parts.push(`title: ${yamlQuote(ns.name)}`);
    parts.push(`description: ${yamlQuote(`API reference for namespace ${ns.name}`)}`);

    const api: Record<string, string[]> = {};
    if (ns.functions.length > 0) api.functions = ns.functions.map(f => f.name);
    if (ns.enums.length > 0) api.enums = ns.enums.map(e => e.name);
    if (ns.structs.length > 0) api.structs = ns.structs.map(s => s.name);
    if (ns.typedefs.length > 0) api.typedefs = ns.typedefs.map(t => t.name);
    if (ns.variables.length > 0) api.variables = ns.variables.map(v => v.name);

    if (Object.keys(api).length > 0) {
      parts.push("api:");
      for (const [key, names] of Object.entries(api)) {
        parts.push(`  ${key}: [${names.map(n => yamlQuote(n)).join(", ")}]`);
      }
    }

    parts.push("---");
    parts.push("");

    const desc = esc(renderDescription(ns.brief, ns.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (ns.namespaces.length > 0) {
      parts.push("**Nested namespaces:** " + ns.namespaces.join(", "));
      parts.push("");
    }

    renderCalloutSections(ns.additionalSections, parts);

    parts.push(renderedSections);

    return parts.join("\n");
  },

  groupPage(group: DoxygenGroupCompound, renderedSections: string, ctx: RenderContext): string {
    const parts: string[] = [];
    parts.push("---");
    parts.push(`title: ${yamlQuote(group.title)}`);
    parts.push(`description: ${yamlQuote(`API reference for group ${group.title}`)}`);

    const api: Record<string, string[]> = {};
    if (group.functions.length > 0) api.functions = group.functions.map(f => f.name);
    if (group.enums.length > 0) api.enums = group.enums.map(e => e.name);
    if (group.structs.length > 0) api.structs = group.structs.map(s => s.name);
    if (group.typedefs.length > 0) api.typedefs = group.typedefs.map(t => t.name);
    if (group.macros.length > 0) api.macros = group.macros.map(m => m.name);
    if (group.variables.length > 0) api.variables = group.variables.map(v => v.name);

    if (Object.keys(api).length > 0) {
      parts.push("api:");
      for (const [key, names] of Object.entries(api)) {
        parts.push(`  ${key}: [${names.map(n => yamlQuote(n)).join(", ")}]`);
      }
    }

    parts.push("---");
    parts.push("");

    const desc = esc(renderDescription(group.brief, group.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (group.innerGroups.length > 0) {
      parts.push("**Subgroups:** " + group.innerGroups.join(", "));
      parts.push("");
    }

    renderCalloutSections(group.additionalSections, parts);

    parts.push(renderedSections);

    return parts.join("\n");
  },

  docsPage(page: DoxygenPageCompound): string {
    const parts: string[] = [];
    writeFrontmatter(parts, page.title, page.brief || page.title);

    const desc = esc(renderDescription(page.brief, page.description));
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    return parts.join("\n");
  },

  symbolRef(ref: SymbolRef, displayText?: string): string {
    const displayProp = displayText && displayText !== ref.name
      ? ` display="${displayText}"`
      : "";
    return `<ApiLink name="${ref.name}"${displayProp} />`;
  },

  anchor(id: string): string {
    return `<span id="${id}" />`;
  },

  descriptionLink(display: string, path: string): string {
    // Extract the symbol name from the path anchor (e.g. "osal/lv_os_h#lv_lock" → "lv_lock")
    const hashIdx = path.indexOf("#");
    const name = hashIdx >= 0 ? path.substring(hashIdx + 1) : display;
    const displayProp = display !== name ? ` display="${display}"` : "";
    return `<ApiLink name="${name}"${displayProp} />`;
  },

  includesList(includes: IncludeRef[], includedby: IncludeRef[], transitiveIncludes?: Set<string>): string {
    if (includes.length === 0 && includedby.length === 0) return "";

    const props: string[] = [];

    if (includes.length > 0) {
      const names = includes.map((inc) => `"${inc.name}"`);
      props.push(`  includes={[${names.join(", ")}]}`);
    }

    if (includedby.length > 0) {
      const names = includedby.map((inc) => `"${inc.name}"`);
      props.push(`  includedBy={[${names.join(", ")}]}`);
    }

    if (transitiveIncludes && transitiveIncludes.size > 0) {
      const directNames = new Set(includes.map((i) => i.name));
      const transitive = [...transitiveIncludes].filter((n) => !directNames.has(n)).sort();
      if (transitive.length > 0) {
        const names = transitive.map((n) => `"${n}"`);
        props.push(`  transitiveIncludes={[${names.join(", ")}]}`);
      }
    }

    return `## Dependencies\n\n<FileIncludes\n${props.join("\n")}\n/>`;
  },

  memberWrapper(kind: string, name: string, content: string, sourceInfo?: { file: string; line: number; url: string }): string {
    const trimmed = content.replace(/---\n\n?$/, "");
    const srcProps = sourceInfo
      ? ` file="${sourceInfo.file}" line={${sourceInfo.line}} url="${sourceInfo.url}"`
      : "";
    return `<ApiMember kind="${kind}" name="${name}"${srcProps}>\n\n### ${name}\n\n${trimmed}\n</ApiMember>\n`;
  },

  functionGroupTabs(groups: FunctionGroup[], ctx: RenderContext): string {
    const items = groups.map(g => g.label);
    const parts: string[] = [];
    parts.push(`<ApiTabs items={${JSON.stringify(items)}}>`);
    for (const group of groups) {
      parts.push(`<ApiTab value="${group.label}">`);
      parts.push("");
      parts.push(group.rendered.join("\n"));
      parts.push("</ApiTab>");
    }
    parts.push("</ApiTabs>");
    return parts.join("\n");
  },

  memberGroupStart(group: MemberGroup): string {
    const title = group.header.replace(/"/g, '\\"');
    return `<Collapsible title="${title}" defaultOpen>`;
  },

  memberGroupEnd(): string {
    return `</Collapsible>`;
  },

  memberGroupHeading(group: MemberGroup): string {
    const parts = [`## ${group.header}`];
    if (group.description) {
      parts.push("");
      parts.push(esc(group.description));
    }
    return parts.join("\n");
  },

  directoryMeta(dirPath: string, entries: DirectoryEntry[]): RenderedFile | null {
    const dirs = entries.filter((e) => e.isDirectory).sort((a, b) => a.fileName.localeCompare(b.fileName));
    const leafFiles = entries.filter((e) => !e.isDirectory).sort((a, b) => a.fileName.localeCompare(b.fileName));
    const pages: string[] = [
      ...dirs.map((e) => e.fileName),
      ...leafFiles.map((e) => e.fileName),
    ];

    const meta: Record<string, unknown> = {};
    if (dirPath === ".") {
      meta.title = "API";
    } else {
      const dirName = dirPath.split("/").pop() || dirPath;
      meta.title = capitalize(dirName);
    }
    meta.pages = pages;

    const metaPath = dirPath === "." ? "meta.json" : `${dirPath}/meta.json`;
    return { path: metaPath, content: JSON.stringify(meta, null, 2) };
  },

  apiSummary(counts: ApiCounts): string {
    const props: string[] = [];
    if (counts.functions > 0) props.push(`functions={${counts.functions}}`);
    if (counts.enums > 0) props.push(`enums={${counts.enums}}`);
    if (counts.structs > 0) props.push(`structs={${counts.structs}}`);
    if (counts.typedefs > 0) props.push(`typedefs={${counts.typedefs}}`);
    if (counts.macros > 0) props.push(`macros={${counts.macros}}`);
    if (counts.variables > 0) props.push(`variables={${counts.variables}}`);
    if (props.length === 0) return "";
    return `<ApiSummary ${props.join(" ")} />`;
  },

  typeUsedBy(typeName: string, entries: TypeUsageEntry[]): string {
    const parts: string[] = [];
    parts.push(`<TypeUsedBy name="${typeName}" count={${entries.length}}>`);
    parts.push("");
    for (const entry of entries) {
      parts.push(`- \`${entry.functionName}\` — param \`${entry.paramName}\``);
    }
    parts.push("");
    parts.push("</TypeUsedBy>");
    return parts.join("\n");
  },

  callbackSignature(name: string, signature: string): string {
    return ` <CallbackSignature name="${name}" signature="${signature.replace(/"/g, "&quot;")}" />`;
  },

  relatedHeaders(currentName: string, _pairedPath: string, currentIsPrivate: boolean): string {
    if (currentIsPrivate) {
      const publicName = currentName.replace("_private.h", ".h");
      return `<RelatedHeaders name="${publicName}" isPrivate={true} />`;
    }
    const privateName = currentName.replace(".h", "_private.h");
    return `<RelatedHeaders name="${privateName}" isPrivate={false} />`;
  },

  sourceLink(location: SourceLocation, baseUrl: string): string {
    const url = `${baseUrl}/${location.file}#L${location.line}`;
    return `<SourceLink file="${location.file}" line={${location.line}} url="${url}" />`;
  },

  directoryIndex(dirPath: string, entries: DirectoryIndexEntry[], context?: DirectoryIndexContext): RenderedFile | null {
    if (entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => a.fileName.localeCompare(b.fileName));
    const dirName = dirPath === "." ? "API Reference" : capitalize(dirPath.split("/").pop() || dirPath);

    const subdirs = sorted.filter((e) => e.isDirectory);
    const leafFiles = sorted.filter((e) => !e.isDirectory);

    const parts: string[] = [];
    parts.push("---");
    parts.push(`title: ${dirName}`);
    parts.push(`description: API reference for the ${dirName.toLowerCase()} module`);
    parts.push("---");
    parts.push("");

    // Root page enhancements: custom intro content and aggregate stats
    if (dirPath === "." && context) {
      let introContent = context.introContent ?? "";
      if (context.totalCounts) {
        const summary = fumadocsPreset.apiSummary!(context.totalCounts);
        if (summary) {
          const indexSummary = summary.replace("<ApiSummary ", "<ApiSummary isIndex ");
          // Replace placeholder in intro content, or append after intro
          if (introContent && /< *API *Summary *\/?>|< *APISummary *\/?>/.test(introContent)) {
            introContent = introContent.replace(/< *API *Summary *\/?>|< *APISummary *\/?>/, indexSummary);
          } else if (introContent) {
            introContent = introContent.trimEnd() + "\n\n" + indexSummary;
          } else {
            introContent = indexSummary;
          }
        }
      }
      if (introContent) {
        parts.push(introContent.trimEnd());
        parts.push("");
      }
    }

    // List subdirectories
    if (subdirs.length > 0) {
      parts.push("## Modules");
      parts.push("");
      const itemStrings = subdirs.map((sub) => {
        const props: string[] = [
          `title: "${titleCase(sub.fileName)}"`,
          `href: "./${sub.fileName}"`,
        ];
        // Use aggregate counts as description for root-level module cards
        if (dirPath === "." && context?.totalCounts) {
          const countParts: string[] = [];
          if (sub.counts.functions > 0) countParts.push(`${sub.counts.functions} functions`);
          const types = sub.counts.enums + sub.counts.structs + sub.counts.typedefs;
          if (types > 0) countParts.push(`${types} types`);
          if (sub.counts.macros > 0) countParts.push(`${sub.counts.macros} macros`);
          if (countParts.length > 0) {
            props.push(`description: "${countParts.join(", ")}"`);
          }
        } else if (sub.brief) {
          props.push(`description: "${sub.brief.replace(/"/g, '\\"')}"`);
        }
        return `  { ${props.join(", ")} }`;
      });
      parts.push(`<IndexCards items={[`);
      parts.push(itemStrings.join(",\n"));
      parts.push(`]} />`);
      parts.push("");
    }

    // List leaf header files
    if (leafFiles.length > 0) {
      if (subdirs.length > 0) {
        parts.push("## Headers");
        parts.push("");
      }
      parts.push("<ModuleOverview>");
      parts.push("");
      const hasAnyDescription = leafFiles.some((e) => !!e.brief);
      if (hasAnyDescription) {
        parts.push("| Header | Description | Functions | Types |");
        parts.push("|--------|-------------|-----------|-------|");
        for (const entry of leafFiles) {
          const types = entry.counts.enums + entry.counts.structs + entry.counts.typedefs;
          parts.push(
            `| <ApiLink name="${entry.title}" /> | ${sanitizeForMdxTableCell(entry.brief || "")} | ${entry.counts.functions} | ${types} |`,
          );
        }
      } else {
        parts.push("| Header | Functions | Types |");
        parts.push("|--------|-----------|-------|");
        for (const entry of leafFiles) {
          const types = entry.counts.enums + entry.counts.structs + entry.counts.typedefs;
          parts.push(
            `| <ApiLink name="${entry.title}" /> | ${entry.counts.functions} | ${types} |`,
          );
        }
      }
      parts.push("");
      parts.push("</ModuleOverview>");
      parts.push("");
    }

    const indexPath = dirPath === "." ? "index.mdx" : `${dirPath}/index.mdx`;
    return { path: indexPath, content: parts.join("\n") };
  },
};
