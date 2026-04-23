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
  DoxygenFriend,
  SymbolRef,
  TypeRef,
  IncludeRef,
  SourceLocation,
  MemberGroup,
} from "../../parser/types.js";
import type { TypeUsageEntry } from "../../analyzer/types.js";
import type { TemplateSet, RenderContext, FunctionGroup, ApiCounts, DirectoryIndexEntry, DirectoryIndexContext, RenderedFile } from "../types.js";

/**
 * Escape `|` characters outside of backtick code spans and `{{...}}`
 * placeholders so they don't split Markdown table cells. Inside `` `...` ``
 * code spans pipes are left as-is (GFM treats them literally). Inside
 * `{{dxlink:display|path}}` placeholders pipes are left as-is because those
 * get replaced later in the pipeline (see resolveDescriptionLinks).
 */
export function escapePipesOutsideCode(text: string): string {
  if (!text || text.indexOf("|") < 0) return text;
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    // Preserve backtick code spans (only if matched)
    if (c === "`") {
      const closeIdx = text.indexOf("`", i + 1);
      if (closeIdx >= 0) {
        out += text.substring(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
      // Unmatched backtick — treat as literal and keep escaping pipes in rest
      out += c;
      i++;
      continue;
    }
    // Preserve {{...}} placeholders (dxlink, dxanchor, etc.)
    if (c === "{" && text[i + 1] === "{") {
      const end = text.indexOf("}}", i + 2);
      if (end >= 0) {
        out += text.substring(i, end + 2);
        i = end + 2;
        continue;
      }
    }
    if (c === "|" && (i === 0 || text[i - 1] !== "\\")) {
      out += "\\|";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Sanitize text for inclusion in a markdown table cell (no newlines or code blocks). */
export function sanitizeForTableCell(text: string): string {
  if (!text) return "";
  // Convert fenced code blocks to inline code
  let result = text.replace(/\n?```\w*\n([\s\S]*?)\n```\n?/g, (_, code) => {
    return " `" + code.trim().replace(/\n/g, " ") + "` ";
  });
  // Escape unescaped pipes outside of code spans so they don't split cells
  result = escapePipesOutsideCode(result);
  // Replace remaining newlines with <br/>
  result = result.replace(/\n/g, "<br/>");
  return result.trim();
}

/** Clean anonymous union/struct names from Doxygen's generated identifiers. */
export function cleanAnonymousTypes(text: string): string {
  return text.replace(/(union|struct)\s+\w+::@\d+\w*/g, '(anonymous $1)');
}

export function formatTypeRef(
  typeRef: TypeRef,
  symbolRef: (ref: SymbolRef, displayText?: string) => string,
): string {
  if (typeRef.refs.length === 0) return `\`${cleanAnonymousTypes(typeRef.text)}\``;

  // Single ref: pass full type text as displayText so it renders as one unit
  // e.g. "lv_draw_task_t *" → symbolRef(ref, "lv_draw_task_t *") instead of separate segments
  if (typeRef.refs.length === 1) {
    return symbolRef(typeRef.refs[0], typeRef.text);
  }

  // Sort refs by name length descending to prevent greedy substring matches
  // (e.g., ref "T" must not replace the T in "ThingOrOther")
  const sortedRefs = [...typeRef.refs].sort(
    (a, b) => b.name.length - a.name.length,
  );

  // Replace each ref name with a placeholder token, using split/join for replaceAll
  let result = typeRef.text;
  const rendered: string[] = [];
  for (let i = 0; i < sortedRefs.length; i++) {
    rendered.push(symbolRef(sortedRefs[i]));
    result = result.split(sortedRefs[i].name).join(`\x00${i}\x00`);
  }

  // Split on placeholder boundaries and reconstruct with backtick-wrapped text
  const segments: string[] = [];
  for (const part of result.split("\x00")) {
    const idx = Number(part);
    if (part !== "" && !isNaN(idx) && idx >= 0 && idx < rendered.length && String(idx) === part) {
      segments.push(rendered[idx]);
    } else if (part) {
      segments.push(`\`${part}\``);
    }
  }
  return segments.join("");
}

export function formatSignature(fn: DoxygenFunction): string {
  const parts: string[] = [];
  if (fn.templateParams && fn.templateParams.length > 0) {
    const tps = fn.templateParams
      .map((tp) => `${tp.type.text} ${tp.name}`.trim())
      .join(", ");
    parts.push(`template <${tps}>`);
  }
  if (fn.definition && fn.argsstring !== undefined) {
    parts.push(`${fn.definition}${fn.argsstring}`);
  } else {
    const params = fn.params
      .map((p) => `${p.type.text} ${p.name}`.trim())
      .join(", ");
    parts.push(`${fn.returnType.text} ${fn.name}(${params})`);
  }
  return parts.join("\n");
}

export function hasCppAttributes(fn: DoxygenFunction): boolean {
  return !!(
    fn.isConst ||
    fn.isConstexpr ||
    fn.isNoexcept ||
    fn.isExplicit ||
    fn.virtualKind ||
    fn.isFinal ||
    fn.isNodiscard ||
    fn.templateParams
  );
}

export function renderDescription(brief: string, description: string): string {
  const parts: string[] = [];
  if (brief) parts.push(brief);
  if (description && description !== brief) parts.push(description);
  return parts.join("\n\n");
}

/** Capitalize first letter of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render additionalSections shared by all member types. */
export function renderAdditionalSections(
  sections: Record<string, string[]>,
  parts: string[],
): void {
  for (const [key, values] of Object.entries(sections)) {
    for (const value of values) {
      parts.push(`> **${capitalize(key)}:** ${value}`);
      parts.push("");
    }
  }
}

/** Render a macro #define code block, stripping existing trailing backslashes to avoid doubling. */
export function renderMacroDefinition(mac: DoxygenMacro, parts: string[]): void {
  if (mac.params) {
    const paramStr = mac.params.join(", ");
    parts.push("```c");
    if (mac.initializer) {
      parts.push(`#define ${mac.name}(${paramStr}) \\`);
      const initLines = mac.initializer.split("\n").map(l => l.replace(/\s*\\$/, ''));
      for (let i = 0; i < initLines.length; i++) {
        const continuation = i < initLines.length - 1 ? " \\" : "";
        parts.push(`    ${initLines[i]}${continuation}`);
      }
    } else {
      parts.push(`#define ${mac.name}(${paramStr})`);
    }
    parts.push("```");
  } else if (mac.initializer) {
    parts.push("```c");
    const initLines = mac.initializer.split("\n").map(l => l.replace(/\s*\\$/, ''));
    if (initLines.length === 1) {
      parts.push(`#define ${mac.name} ${initLines[0]}`);
    } else {
      parts.push(`#define ${mac.name} ${initLines[0]} \\`);
      for (let i = 1; i < initLines.length; i++) {
        const continuation = i < initLines.length - 1 ? " \\" : "";
        parts.push(`    ${initLines[i]}${continuation}`);
      }
    }
    parts.push("```");
  } else {
    parts.push("```c");
    parts.push(`#define ${mac.name}`);
    parts.push("```");
  }
}

export const markdownTemplates: TemplateSet = {
  extension: ".md",

  page(file: DoxygenFile, renderedSections: string): string {
    const parts: string[] = [];
    parts.push(`# ${file.name}`);
    parts.push("");

    const desc = renderDescription(file.brief, file.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    parts.push(renderedSections);

    return parts.join("\n");
  },

  function(fn: DoxygenFunction, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(fn.name));
    parts.push(`### ${fn.name}`);
    parts.push("");

    const desc = renderDescription(fn.brief, fn.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (fn.inbodyDescription) {
      parts.push(fn.inbodyDescription);
      parts.push("");
    }

    parts.push(hasCppAttributes(fn) ? "```cpp" : "```c");
    parts.push(formatSignature(fn));
    parts.push("```");
    parts.push("");

    if (fn.params.length > 0) {
      const hasAnyParamDesc = fn.params.some((p) => !!p.description);
      parts.push("**Parameters:**");
      parts.push("");
      if (hasAnyParamDesc) {
        parts.push("| Name | Type | Description |");
        parts.push("|------|------|-------------|");
      } else {
        parts.push("| Name | Type |");
        parts.push("|------|------|");
      }
      for (const param of fn.params) {
        // Detect variadic params: name is "..." or type is "..." with empty name
        const isVariadic = param.name === "..." || (param.type.text === "..." && !param.name);
        if (isVariadic) {
          const desc = param.description ? sanitizeForTableCell(param.description) : "";
          parts.push(hasAnyParamDesc ? `| \`...\` | | ${desc} |` : `| \`...\` | |`);
          continue;
        }
        const dirPrefix = param.direction ? `**[${param.direction}]** ` : "";
        const typeText = formatTypeRef(param.type, this.symbolRef);
        const desc = param.description ? sanitizeForTableCell(param.description) : "";
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
        parts.push(`| ${nameCell} | \`${tp.type.text}\` | ${sanitizeForTableCell(tp.description || "")} |`);
      }
      parts.push("");
    }

    if (fn.returnDescription && fn.returnType.text !== "void") {
      parts.push(
        `**Returns:** ${formatTypeRef(fn.returnType, this.symbolRef)} — ${fn.returnDescription}`,
      );
      parts.push("");
    }

    // Retval table
    if (fn.retvalDescriptions.size > 0) {
      parts.push("**Return values:**");
      parts.push("");
      parts.push("| Value | Description |");
      parts.push("|-------|-------------|");
      for (const [val, desc] of fn.retvalDescriptions) {
        parts.push(`| \`${val}\` | ${sanitizeForTableCell(desc)} |`);
      }
      parts.push("");
    }

    // Exceptions table
    if (fn.exceptions.size > 0) {
      parts.push("**Exceptions:**");
      parts.push("");
      parts.push("| Exception | Description |");
      parts.push("|-----------|-------------|");
      for (const [exc, desc] of fn.exceptions) {
        parts.push(`| \`${exc}\` | ${sanitizeForTableCell(desc)} |`);
      }
      parts.push("");
    }

    if (fn.notes.length > 0) {
      for (const note of fn.notes) {
        parts.push(`> **Note:** ${note}`);
        parts.push("");
      }
    }

    if (fn.warnings.length > 0) {
      for (const warning of fn.warnings) {
        parts.push(`> **Warning:** ${warning}`);
        parts.push("");
      }
    }

    if (fn.since) {
      parts.push(`**Since:** ${fn.since}`);
      parts.push("");
    }

    if (fn.deprecated) {
      parts.push(`> **Deprecated:** ${fn.deprecated}`);
      parts.push("");
    }

    if (fn.seeAlso.length > 0) {
      parts.push("**See also:** " + fn.seeAlso.join(", "));
      parts.push("");
    }

    renderAdditionalSections(fn.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  enum(en: DoxygenEnum, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(en.name));
    parts.push(`### ${en.name}`);
    parts.push("");

    const desc = renderDescription(en.brief, en.description);
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
        const rawValDesc = val.brief || val.description || "";
        const valDesc = rawValDesc ? sanitizeForTableCell(rawValDesc) : "";
        const cells = [`\`${val.name}\``];
        if (hasAnyValue) cells.push(val.initializer ? `\`${val.initializer.replace(/^=\s*/, "").replace(/\|/g, "\\|")}\`` : "");
        if (hasAnyDesc) cells.push(valDesc);
        parts.push("| " + cells.join(" | ") + " |");
      }
      parts.push("");
    }

    renderAdditionalSections(en.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  struct(st: DoxygenStruct, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(st.name));
    parts.push(`### ${st.name}`);
    parts.push("");

    const desc = renderDescription(st.brief, st.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (st.members.length > 0) {
      parts.push("| Member | Type | Description |");
      parts.push("|--------|------|-------------|");
      for (const member of st.members) {
        const rawDesc = member.brief || member.description || "";
        const memberDesc = rawDesc ? sanitizeForTableCell(rawDesc) : "";
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

    renderAdditionalSections(st.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  macro(mac: DoxygenMacro, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(mac.name));
    parts.push(`### ${mac.name}`);
    parts.push("");

    renderMacroDefinition(mac, parts);
    parts.push("");

    const desc = renderDescription(mac.brief, mac.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (mac.params && mac.params.length > 0 && mac.paramDescriptions && mac.paramDescriptions.size > 0) {
      parts.push("**Parameters:**");
      parts.push("");
      parts.push("| Name | Description |");
      parts.push("|------|-------------|");
      for (const param of mac.params) {
        const paramDesc = mac.paramDescriptions.get(param);
        parts.push(`| \`${param}\` | ${paramDesc ? sanitizeForTableCell(paramDesc) : ""} |`);
      }
      parts.push("");
    }

    if (mac.returnDescription) {
      parts.push(`**Returns:** ${mac.returnDescription}`);
      parts.push("");
    }

    if (mac.retvalDescriptions && mac.retvalDescriptions.size > 0) {
      parts.push("**Return values:**");
      parts.push("");
      parts.push("| Value | Description |");
      parts.push("|-------|-------------|");
      for (const [val, desc] of mac.retvalDescriptions) {
        parts.push(`| \`${val}\` | ${sanitizeForTableCell(desc)} |`);
      }
      parts.push("");
    }

    if (mac.notes && mac.notes.length > 0) {
      for (const note of mac.notes) {
        parts.push(`> **Note:** ${note}`);
        parts.push("");
      }
    }

    if (mac.warnings && mac.warnings.length > 0) {
      for (const warning of mac.warnings) {
        parts.push(`> **Warning:** ${warning}`);
        parts.push("");
      }
    }

    if (mac.since) {
      parts.push(`**Since:** ${mac.since}`);
      parts.push("");
    }

    if (mac.deprecated) {
      parts.push(`> **Deprecated:** ${mac.deprecated}`);
      parts.push("");
    }

    if (mac.seeAlso && mac.seeAlso.length > 0) {
      parts.push("**See also:** " + mac.seeAlso.join(", "));
      parts.push("");
    }

    renderAdditionalSections(mac.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  typedef(td: DoxygenTypedef, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(td.name));
    parts.push(`### ${td.name}`);
    parts.push("");
    parts.push("```c");
    if (td.definition) {
      parts.push(td.definition);
    } else {
      parts.push(`typedef ${td.type.text} ${td.name}`);
    }
    parts.push("```");
    parts.push("");

    const desc = renderDescription(td.brief, td.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    renderAdditionalSections(td.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  variable(v: DoxygenVariable, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(v.name));
    parts.push(`### ${v.name}`);
    parts.push("");
    parts.push("```c");
    parts.push(`${v.type.text} ${v.name}`);
    parts.push("```");
    parts.push("");

    const desc = renderDescription(v.brief, v.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    renderAdditionalSections(v.additionalSections, parts);

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  classPage(cls: DoxygenClassCompound, renderedSections: string, ctx: RenderContext): string {
    const parts: string[] = [];
    parts.push(`# ${cls.name}`);
    parts.push("");

    // Template params
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

    const desc = renderDescription(cls.brief, cls.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    // Inheritance chain
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

    renderAdditionalSections(cls.additionalSections, parts);

    parts.push(renderedSections);

    return parts.join("\n");
  },

  namespacePage(ns: DoxygenNamespaceCompound, renderedSections: string, ctx: RenderContext): string {
    const parts: string[] = [];
    parts.push(`# namespace ${ns.name}`);
    parts.push("");

    const desc = renderDescription(ns.brief, ns.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (ns.namespaces.length > 0) {
      parts.push("**Nested namespaces:** " + ns.namespaces.join(", "));
      parts.push("");
    }

    renderAdditionalSections(ns.additionalSections, parts);

    parts.push(renderedSections);

    return parts.join("\n");
  },

  friend(f: DoxygenFriend, ctx: RenderContext): string {
    const parts: string[] = [];

    parts.push(this.anchor(f.name));
    parts.push(`### ${f.name}`);
    parts.push("");

    if (f.type.text) {
      parts.push("```cpp");
      parts.push(`friend ${f.type.text} ${f.name}`);
      parts.push("```");
      parts.push("");
    }

    const desc = renderDescription(f.brief, f.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    parts.push("---");
    parts.push("");

    return parts.join("\n");
  },

  groupPage(group: DoxygenGroupCompound, renderedSections: string, ctx: RenderContext): string {
    const parts: string[] = [];
    parts.push(`# ${group.title}`);
    parts.push("");

    const desc = renderDescription(group.brief, group.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    if (group.innerGroups.length > 0) {
      parts.push("**Subgroups:** " + group.innerGroups.join(", "));
      parts.push("");
    }

    renderAdditionalSections(group.additionalSections, parts);

    parts.push(renderedSections);

    return parts.join("\n");
  },

  docsPage(page: DoxygenPageCompound): string {
    const parts: string[] = [];
    parts.push(`# ${page.title}`);
    parts.push("");

    const desc = renderDescription(page.brief, page.description);
    if (desc) {
      parts.push(desc);
      parts.push("");
    }

    return parts.join("\n");
  },

  symbolRef(ref: SymbolRef, displayText?: string): string {
    const text = displayText || ref.name;
    if (ref.path) {
      return `[${text}](${ref.path})`;
    }
    return `\`${text}\``;
  },

  descriptionLink(display: string, path: string): string {
    return `[\`${display}\`](${path})`;
  },

  sectionHeading(title: string, level: number): string {
    return "#".repeat(level) + " " + title;
  },

  includesList(includes: IncludeRef[], includedby: IncludeRef[], transitiveIncludes?: Set<string>): string {
    if (includes.length === 0 && includedby.length === 0) return "";
    const parts: string[] = [];

    if (includes.length > 0) {
      parts.push("## Includes");
      parts.push("");
      for (const inc of includes) {
        const bracket = inc.local ? `"${inc.name}"` : `\`<${inc.name}>\``;
        if (inc.path) {
          parts.push(`- [${bracket}](${inc.path})`);
        } else {
          parts.push(`- ${bracket}`);
        }
      }
      parts.push("");

      // Transitive includes
      if (transitiveIncludes && transitiveIncludes.size > 0) {
        const directNames = new Set(includes.map((i) => i.name));
        const transitive = [...transitiveIncludes].filter((n) => !directNames.has(n)).sort();
        if (transitive.length > 0) {
          parts.push("### Transitive Includes");
          parts.push("");
          for (const name of transitive) {
            parts.push(`- ${name}`);
          }
          parts.push("");
        }
      }
    }

    if (includedby.length > 0) {
      parts.push("## Included by");
      parts.push("");
      for (const inc of includedby) {
        if (inc.path) {
          parts.push(`- [${inc.name}](${inc.path})`);
        } else {
          parts.push(`- ${inc.name}`);
        }
      }
      parts.push("");
    }

    return parts.join("\n");
  },

  functionGroupTabs(groups: FunctionGroup[], ctx: RenderContext): string {
    const parts: string[] = [];
    for (const group of groups) {
      parts.push(`### ${group.label}`);
      parts.push("");
      parts.push(group.rendered.join("\n"));
    }
    return parts.join("\n");
  },

  memberGroupHeading(group: MemberGroup): string {
    const parts = [`## ${group.header}`];
    if (group.description) {
      parts.push("");
      parts.push(group.description);
    }
    return parts.join("\n");
  },

  anchor(id: string): string {
    return `<a id="${id}"></a>`;
  },

  apiSummary(counts: ApiCounts): string {
    const parts: string[] = [];
    if (counts.functions > 0) parts.push(`${counts.functions} functions`);
    if (counts.enums > 0) parts.push(`${counts.enums} enums`);
    if (counts.structs > 0) parts.push(`${counts.structs} structs`);
    if (counts.typedefs > 0) parts.push(`${counts.typedefs} typedefs`);
    if (counts.macros > 0) parts.push(`${counts.macros} macros`);
    if (counts.variables > 0) parts.push(`${counts.variables} variables`);
    if (parts.length === 0) return "";
    return `> **API Surface:** ${parts.join(" · ")}`;
  },

  typeUsedBy(typeName: string, entries: TypeUsageEntry[]): string {
    const refs = entries.map(
      (e) => `\`${e.functionName}\` (param \`${e.paramName}\`)`,
    );
    return `**Used by:** ${refs.join(", ")}`;
  },

  callbackSignature(name: string, signature: string): string {
    return ` → \`${signature}\``;
  },

  relatedHeaders(currentName: string, pairedPath: string, currentIsPrivate: boolean): string {
    if (currentIsPrivate) {
      const publicName = currentName.replace("_private.h", ".h");
      return `> **See also:** [${publicName}](${pairedPath}) (public API)`;
    }
    const privateName = currentName.replace(".h", "_private.h");
    return `> **See also:** [${privateName}](${pairedPath}) (internal types)`;
  },

  sourceLink(location: SourceLocation, baseUrl: string): string {
    const url = `${baseUrl}/${location.file}#L${location.line}`;
    const display = `${location.file}:${location.line}`;
    return `*Source: [${display}](${url})*`;
  },

  directoryIndex(dirPath: string, entries: DirectoryIndexEntry[], _context?: DirectoryIndexContext): RenderedFile | null {
    if (entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => a.fileName.localeCompare(b.fileName));
    const dirName = dirPath === "." ? "API Reference" : capitalize(dirPath.split("/").pop() || dirPath);

    const subdirs = sorted.filter((e) => e.isDirectory);
    const leafFiles = sorted.filter((e) => !e.isDirectory);

    const parts: string[] = [];
    parts.push(`# ${dirName}`);
    parts.push("");

    // List subdirectories
    if (subdirs.length > 0) {
      parts.push("## Modules");
      parts.push("");
      const currentDir = dirPath.split("/").pop() || dirPath;
      for (const sub of subdirs) {
        parts.push(`- [${sub.title}](./${currentDir}/${sub.fileName})`);
      }
      parts.push("");
    }

    // List leaf header files
    if (leafFiles.length > 0) {
      if (subdirs.length > 0) {
        parts.push("## Headers");
        parts.push("");
      }
      const hasAnyDescription = leafFiles.some((e) => !!e.brief);
      if (hasAnyDescription) {
        parts.push("| Header | Description | Functions | Types |");
        parts.push("|--------|-------------|-----------|-------|");
        for (const entry of leafFiles) {
          const types = entry.counts.enums + entry.counts.structs + entry.counts.typedefs;
          parts.push(
            `| [${entry.title}](./${entry.fileName}) | ${entry.brief || ""} | ${entry.counts.functions} | ${types} |`,
          );
        }
      } else {
        parts.push("| Header | Functions | Types |");
        parts.push("|--------|-----------|-------|");
        for (const entry of leafFiles) {
          const types = entry.counts.enums + entry.counts.structs + entry.counts.typedefs;
          parts.push(
            `| [${entry.title}](./${entry.fileName}) | ${entry.counts.functions} | ${types} |`,
          );
        }
      }
    }
    parts.push("");

    const indexPath = dirPath === "." ? "index.md" : `${dirPath}/index.md`;
    return { path: indexPath, content: parts.join("\n") };
  },
};
