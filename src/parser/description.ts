import type { SymbolRef } from "./types.js";
import type { WarningCollector } from "./warnings.js";
import { createNullCollector } from "./warnings.js";
import { ENTITY_MAP } from "./entities.js";
import type { PONode } from "./xml-helpers.js";
import {
  getTagName,
  getChild,
  getChildren,
  findChild,
  findChildren,
  getAttr,
  getText,
} from "./xml-helpers.js";

/**
 * Result of parsing a description XML node.
 * Contains the markdown text plus extracted metadata fields.
 */
export interface DescriptionResult {
  markdown: string;
  returnDescription: string;
  paramDescriptions: Map<string, string>;
  retvalDescriptions: Map<string, string>;
  exceptionDescriptions: Map<string, string>;
  templateParamDescriptions: Map<string, string>;
  paramDirections: Map<string, "in" | "out" | "inout">;
  notes: string[];
  warnings: string[];
  since?: string;
  deprecated?: string;
  seeAlso: string[];
  refs: SymbolRef[];
  additionalSections: Record<string, string[]>;
}

function emptyResult(): DescriptionResult {
  return {
    markdown: "",
    returnDescription: "",
    paramDescriptions: new Map(),
    retvalDescriptions: new Map(),
    exceptionDescriptions: new Map(),
    templateParamDescriptions: new Map(),
    paramDirections: new Map(),
    notes: [],
    warnings: [],
    seeAlso: [],
    refs: [],
    additionalSections: {},
  };
}

/**
 * Parse a <detaileddescription> or <briefdescription> node into markdown
 * plus extracted structured fields.
 *
 * With preserveOrder, the node is a PONode[] array.
 */
export function parseDescription(
  node: unknown,
  collector?: WarningCollector,
): DescriptionResult {
  const result = emptyResult();
  const col = collector ?? createNullCollector();

  if (!node || !Array.isArray(node)) {
    if (typeof node === "string") {
      result.markdown = node.trim();
    }
    return result;
  }

  const parts: string[] = [];
  walkNodes(node as PONode[], parts, result, col);
  result.markdown = cleanMarkdown(parts.join(""));

  return result;
}

/**
 * Parse a brief description, returning just the text.
 */
export function parseBriefDescription(
  node: unknown,
  collector?: WarningCollector,
): string {
  if (!node) return "";
  if (typeof node === "string") return node.trim();
  if (!Array.isArray(node)) return "";

  const result = emptyResult();
  const col = collector ?? createNullCollector();

  const parts: string[] = [];
  walkNodes(node as PONode[], parts, result, col);
  return cleanMarkdown(parts.join(""));
}

/** Set of element names explicitly handled in walkNodes. */
const HANDLED_TAGS = new Set([
  "#text",
  "para",
  "ref",
  "emphasis",
  "bold",
  "computeroutput",
  "programlisting",
  "orderedlist",
  "itemizedlist",
  "simplesect",
  "parameterlist",
  "ulink",
  "table",
  "linebreak",
  "formula",
  "heading",
  "blockquote",
  "variablelist",
  "verbatim",
  "image",
  "anchor",
  "preformatted",
  "hruler",
  "details",
  "parblock",
  "sect1", "sect2", "sect3", "sect4", "sect5", "sect6",
  "xrefsect",
  "s", "strike", "del",
  "underline",
  "subscript",
  "superscript",
  "nonbreakablespace",
  "emoji",
  // Elements that are part of compound structures (not standalone)
  "title", "listitem", "parameteritem", "parameternamelist",
  "parametername", "parameterdescription",
  "row", "entry", "codeline", "highlight", "sp",
  "varlistentry", "term", "xreftitle", "xrefdescription",
  "summary",
  // Diagram elements
  "dot", "msc", "plantuml",
  // Explicit skips (no warning needed)
  "toclist", "htmlonly", "latexonly", "rtfonly", "docbookonly",
  "manonly", "xmlonly", "internal", "copydoc", "language",
  "indexentry", "javadocliteral", "javadoccode",
]);

/**
 * Walk an array of preserveOrder nodes, appending markdown to parts.
 * This is the core of the description parser — because preserveOrder
 * gives us elements in document order, text and inline elements are
 * naturally interleaved.
 */
function walkNodes(
  nodes: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  for (const node of nodes) {
    const tag = getTagName(node);
    const children = node[tag] as PONode[];

    switch (tag) {
      case "#text": {
        // Strip C++ scope resolution prefix (e.g. "::TypeName" → "TypeName")
        const rawText = String(node["#text"]);
        parts.push(rawText.replace(/(?<!\w)::(\w)/g, '$1'));
        break;
      }

      case "para":
        walkNodes(children, parts, result, collector);
        parts.push("\n\n");
        break;

      case "ref":
        handleRef(node, children, parts, result);
        break;

      case "emphasis":
        parts.push("*");
        walkNodes(children, parts, result, collector);
        parts.push("*");
        break;

      case "bold":
        parts.push("**");
        walkNodes(children, parts, result, collector);
        parts.push("**");
        break;

      case "computeroutput":
        handleComputerOutput(children, parts, result, collector);
        break;

      case "programlisting":
        handleProgramListing(node, children, parts);
        break;

      case "orderedlist":
        handleOrderedList(children, parts, result, collector);
        break;

      case "itemizedlist":
        handleItemizedList(children, parts, result, collector);
        break;

      case "simplesect":
        handleSimpleSect(node, children, parts, result, collector);
        break;

      case "parameterlist":
        handleParameterList(node, children, result, collector);
        break;

      case "ulink":
        handleUlink(node, children, parts);
        break;

      case "table":
        handleTable(children, parts, result, collector);
        break;

      case "linebreak":
        parts.push("<br/>");
        break;

      case "formula":
        handleFormula(children, parts);
        break;

      case "heading": {
        const level = Number(getAttr(node, "level") ?? 3);
        parts.push("\n" + "#".repeat(level) + " ");
        walkNodes(children, parts, result, collector);
        parts.push("\n\n");
        break;
      }

      case "sect1": case "sect2": case "sect3":
      case "sect4": case "sect5": case "sect6":
        handleSect(children, parseInt(tag.slice(4)), parts, result, collector);
        break;

      case "xrefsect":
        handleXrefSect(children, parts, result, collector);
        break;

      case "blockquote":
        handleBlockquote(children, parts, result, collector);
        break;

      case "variablelist":
        handleVariableList(children, parts, result, collector);
        break;

      case "verbatim":
        handleCodeBlock(children, parts, result, collector);
        break;

      case "image":
        handleImage(node, children, parts);
        break;

      case "anchor": {
        const anchorId = getAttr(node, "id") ?? "";
        if (anchorId) {
          parts.push(`{{dxanchor:${anchorId}}}`);
        }
        break;
      }

      case "preformatted":
        handleCodeBlock(children, parts, result, collector);
        break;

      case "hruler":
        parts.push("\n---\n\n");
        break;

      case "details":
        handleDetails(children, node, parts, result, collector);
        break;

      case "parblock":
        walkNodes(children, parts, result, collector);
        break;

      // Diagram elements
      case "dot":
      case "msc":
      case "plantuml":
        handleDiagram(children, tag, parts);
        break;

      // Strikethrough variants
      case "s":
      case "strike":
      case "del":
        parts.push("~~");
        walkNodes(children, parts, result, collector);
        parts.push("~~");
        break;

      case "underline":
        parts.push("<u>");
        walkNodes(children, parts, result, collector);
        parts.push("</u>");
        break;

      case "subscript":
        parts.push("<sub>");
        walkNodes(children, parts, result, collector);
        parts.push("</sub>");
        break;

      case "superscript":
        parts.push("<sup>");
        walkNodes(children, parts, result, collector);
        parts.push("</sup>");
        break;

      case "nonbreakablespace":
        parts.push("\u00A0");
        break;

      case "emoji":
        handleEmoji(node, parts);
        break;

      default: {
        // Check entity map first
        const entityChar = ENTITY_MAP[tag];
        if (entityChar !== undefined) {
          parts.push(entityChar);
        } else if (!HANDLED_TAGS.has(tag)) {
          collector.warn(`Unknown description element: <${tag}>`);
        }
        break;
      }
    }
  }
}

function handleComputerOutput(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  // Check if any child is a <ref> element
  const hasRef = children.some((c) => getTagName(c) === "ref");
  if (!hasRef) {
    // Simple case: no refs, just wrap in backticks
    parts.push("`");
    walkNodes(children, parts, result, collector);
    parts.push("`");
    return;
  }

  // Mixed case: refs and text inside computeroutput
  // Emit refs as backtick-styled links, plain text as inline code
  for (const child of children) {
    const tag = getTagName(child);
    if (tag === "ref") {
      const refChildren = child["ref"] as PONode[];
      const name = getText(refChildren);
      const refid = getAttr(child, "refid") ?? "";
      if (name) {
        const ref: SymbolRef = { name, refid };
        result.refs.push(ref);
        parts.push(`[\`${name}\`]({{dxref:${refid}}})`);
      }
    } else if (tag === "#text") {
      const text = String(child["#text"]);
      if (text.trim()) {
        parts.push(`\`${text}\``);
      } else {
        parts.push(text);
      }
    }
  }
}

function handleRef(
  node: PONode,
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
): void {
  const name = getText(children);
  const refid = getAttr(node, "refid") ?? "";

  if (name) {
    const ref: SymbolRef = { name, refid };
    result.refs.push(ref);
    parts.push(`[${name}]({{dxref:${refid}}})`);
  }
}

function handleProgramListing(
  node: PONode,
  children: PONode[],
  parts: string[],
): void {
  const filename = getAttr(node, "filename") ?? "";
  let lang = "c";
  if (filename) {
    if (filename.endsWith(".py")) lang = "python";
    else if (filename.endsWith(".js")) lang = "javascript";
    else if (filename.endsWith(".ts")) lang = "typescript";
    else if (filename.endsWith(".cpp") || filename.endsWith(".cxx"))
      lang = "cpp";
    else if (filename.endsWith(".h") || filename.endsWith(".c")) lang = "c";
    else if (filename.endsWith(".java")) lang = "java";
    else if (filename.endsWith(".rs")) lang = "rust";
    else if (filename !== ".") lang = "";
  }

  parts.push("\n```" + lang + "\n");

  // Walk codeline children
  const codelineNodes = findChildren(children, "codeline");
  for (const clNode of codelineNodes) {
    const clChildren = clNode["codeline"] as PONode[];
    // Walk highlight children
    const highlightNodes = findChildren(clChildren, "highlight");
    for (const hNode of highlightNodes) {
      const hChildren = hNode["highlight"] as PONode[];
      for (const item of hChildren) {
        const itemTag = getTagName(item);
        if (itemTag === "#text") {
          parts.push(String(item["#text"]));
        } else if (itemTag === "sp") {
          parts.push(" ");
        } else if (itemTag === "ref") {
          const refChildren = item["ref"] as PONode[];
          parts.push(getText(refChildren));
        }
      }
    }
    parts.push("\n");
  }

  parts.push("```\n\n");
}

function handleOrderedList(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const items = findChildren(children, "listitem");
  let i = 1;
  parts.push("\n");
  for (const itemNode of items) {
    const itemChildren = itemNode["listitem"] as PONode[];
    parts.push(`${i}. `);
    const itemParts: string[] = [];
    walkNodes(itemChildren, itemParts, result, collector);
    parts.push(cleanMarkdown(itemParts.join("")).replace(/\n\n$/, ""));
    parts.push("\n");
    i++;
  }
  parts.push("\n");
}

function handleItemizedList(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const items = findChildren(children, "listitem");
  parts.push("\n");
  for (const itemNode of items) {
    const itemChildren = itemNode["listitem"] as PONode[];
    parts.push("- ");
    const itemParts: string[] = [];
    walkNodes(itemChildren, itemParts, result, collector);
    parts.push(cleanMarkdown(itemParts.join("")).replace(/\n\n$/, ""));
    parts.push("\n");
  }
  parts.push("\n");
}

function handleSimpleSect(
  node: PONode,
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const kind = getAttr(node, "kind") ?? "";

  // Use isolated result to prevent double-counting nested content
  const sectResult = emptyResult();
  const contentParts: string[] = [];
  walkNodes(children, contentParts, sectResult, collector);
  const content = cleanMarkdown(contentParts.join(""));
  // Merge only refs back into the parent result
  result.refs.push(...sectResult.refs);

  switch (kind) {
    case "return":
      result.returnDescription = content;
      break;
    case "note":
      result.notes.push(content);
      break;
    case "warning":
      result.warnings.push(content);
      break;
    case "since":
      result.since = content;
      break;
    case "deprecated":
      result.deprecated = content;
      break;
    case "see":
      result.seeAlso.push(content);
      break;
    case "par": {
      // <par> has a <title> child that becomes the section heading
      const titleChildren = getChild(children, "title");
      const title = titleChildren
        ? cleanMarkdown(getText(titleChildren))
        : "Note";
      // Get content from para children
      const parParts: string[] = [];
      const paraChildren = getChildren(children, "para");
      for (const paraChild of paraChildren) {
        walkNodes(paraChild, parParts, result, collector);
        parParts.push("\n\n");
      }
      const parContent = cleanMarkdown(parParts.join(""));
      if (!result.additionalSections[title]) {
        result.additionalSections[title] = [];
      }
      result.additionalSections[title].push(parContent || content);
      break;
    }
    case "author":
    case "authors":
    case "version":
    case "remark":
    case "todo":
    case "attention":
    case "pre":
    case "post":
    case "invariant":
    case "important":
    case "date":
    case "copyright":
    case "rcs": {
      const sectionKey =
        kind === "authors" ? "author" : kind;
      if (!result.additionalSections[sectionKey]) {
        result.additionalSections[sectionKey] = [];
      }
      result.additionalSections[sectionKey].push(content);
      break;
    }
    default:
      if (kind) {
        collector.warn(`Unknown simplesect kind: ${kind}`);
      }
      // Include in main markdown as fallback
      parts.push(content);
      break;
  }
}

function handleParameterList(
  node: PONode,
  children: PONode[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const kind = getAttr(node, "kind") ?? "param";

  // Choose target map based on kind
  let targetMap: Map<string, string>;
  switch (kind) {
    case "param":
      targetMap = result.paramDescriptions;
      break;
    case "retval":
      targetMap = result.retvalDescriptions;
      break;
    case "exception":
      targetMap = result.exceptionDescriptions;
      break;
    case "templateparam":
      targetMap = result.templateParamDescriptions;
      break;
    default:
      collector.warn(`Unknown parameterlist kind: ${kind}`);
      targetMap = result.paramDescriptions;
      break;
  }

  const itemNodes = findChildren(children, "parameteritem");
  for (const itemNode of itemNodes) {
    const itemChildren = itemNode["parameteritem"] as PONode[];

    // Get parameternamelist
    const nameListChildren = getChild(itemChildren, "parameternamelist");
    if (!nameListChildren) continue;

    // Get parametername
    const paramNameNode = findChild(nameListChildren, "parametername");
    if (!paramNameNode) continue;

    const paramNameChildren = paramNameNode["parametername"] as PONode[];
    const name = getText(paramNameChildren);
    const direction = getAttr(paramNameNode, "direction");

    // Store direction for param kind
    if (direction && kind === "param") {
      if (
        direction === "in" ||
        direction === "out" ||
        direction === "inout"
      ) {
        result.paramDirections.set(name, direction);
      }
    }

    // Get parameterdescription
    const descChildren = getChild(itemChildren, "parameterdescription");
    if (descChildren) {
      const descParts: string[] = [];
      const descResult = emptyResult();
      walkNodes(descChildren, descParts, descResult, collector);
      targetMap.set(name, cleanMarkdown(descParts.join("")));
      // Merge refs
      result.refs.push(...descResult.refs);
    }
  }
}

function handleSect(
  children: PONode[],
  level: number,
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  // Title
  const titleChildren = getChild(children, "title");
  if (titleChildren) {
    const headingLevel = level + 1;
    parts.push("\n" + "#".repeat(headingLevel) + " ");
    walkNodes(titleChildren, parts, result, collector);
    parts.push("\n\n");
  }

  // Para children
  const paraArrays = getChildren(children, "para");
  for (const paraChildren of paraArrays) {
    walkNodes(paraChildren, parts, result, collector);
    parts.push("\n\n");
  }

  // Nested sect(N+1)
  const nextTag = `sect${level + 1}`;
  const nestedSectNodes = findChildren(children, nextTag);
  for (const nestedNode of nestedSectNodes) {
    const nestedChildren = nestedNode[nextTag] as PONode[];
    handleSect(nestedChildren, level + 1, parts, result, collector);
  }
}

function handleXrefSect(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const titleChildren = getChild(children, "xreftitle");
  const title = titleChildren ? getText(titleChildren) : "Reference";

  const descChildren = getChild(children, "xrefdescription");
  const descParts: string[] = [];
  if (descChildren) {
    walkNodes(descChildren, descParts, result, collector);
  }
  const desc = cleanMarkdown(descParts.join(""));
  parts.push(`\n> **${title}:** ${desc}\n\n`);
}

function handleBlockquote(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  // Flatten: if the only meaningful child is another blockquote, skip a nesting level
  const meaningfulChildren = children.filter((c) => {
    const t = getTagName(c);
    return t !== "#text" || String(c["#text"]).trim() !== "";
  });
  if (meaningfulChildren.length === 1 && getTagName(meaningfulChildren[0]) === "blockquote") {
    const innerChildren = meaningfulChildren[0]["blockquote"] as PONode[];
    handleBlockquote(innerChildren, parts, result, collector);
    return;
  }

  const innerParts: string[] = [];
  walkNodes(children, innerParts, result, collector);
  const content = cleanMarkdown(innerParts.join(""));
  const quoted = content
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  parts.push("\n" + quoted + "\n\n");
}

function handleVariableList(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const entryNodes = findChildren(children, "varlistentry");
  const itemNodes = findChildren(children, "listitem");

  parts.push("\n");
  for (let i = 0; i < entryNodes.length; i++) {
    const entryChildren = entryNodes[i]["varlistentry"] as PONode[];
    const termChildren = getChild(entryChildren, "term");
    const termParts: string[] = [];
    if (termChildren) {
      walkNodes(termChildren, termParts, result, collector);
    }
    parts.push(`**${cleanMarkdown(termParts.join(""))}**\n`);

    if (i < itemNodes.length) {
      const defChildren = itemNodes[i]["listitem"] as PONode[];
      const defParts: string[] = [];
      walkNodes(defChildren, defParts, result, collector);
      parts.push(`: ${cleanMarkdown(defParts.join(""))}\n\n`);
    }
  }
}

function handleImage(
  node: PONode,
  children: PONode[],
  parts: string[],
): void {
  const imageType = getAttr(node, "type") ?? "";

  // Only render HTML images (skip latex/rtf)
  if (imageType && imageType !== "html") return;

  const name = getAttr(node, "name") ?? "";
  const alt = getText(children) || name;

  parts.push(`![${alt}](${name})`);
}

function handleDetails(
  children: PONode[],
  node: PONode,
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  parts.push("<details>");

  const summaryChildren = getChild(children, "summary");
  if (summaryChildren) {
    parts.push("<summary>");
    walkNodes(summaryChildren, parts, result, collector);
    parts.push("</summary>");
  }

  parts.push("\n");
  // Walk remaining content (para elements, etc.)
  for (const child of children) {
    const childTag = getTagName(child);
    if (childTag === "summary") continue; // already handled
    if (childTag === "para") {
      const paraChildren = child["para"] as PONode[];
      walkNodes(paraChildren, parts, result, collector);
      parts.push("\n\n");
    } else {
      walkNodes([child], parts, result, collector);
    }
  }
  parts.push("</details>\n\n");
}

function handleCodeBlock(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
  lang?: string,
): void {
  const langSuffix = lang ? lang : "";
  parts.push(`\n\`\`\`${langSuffix}\n`);
  // For verbatim/preformatted, the content is typically just #text children
  const text = getText(children);
  if (text) {
    parts.push(text);
  } else {
    walkNodes(children, parts, result, collector);
  }
  parts.push("\n```\n\n");
}

function handleDiagram(
  children: PONode[],
  lang: string,
  parts: string[],
): void {
  const content = getText(children);
  parts.push(`\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`);
}

function handleEmoji(
  node: PONode,
  parts: string[],
): void {
  const unicode = getAttr(node, "unicode");
  const name = getAttr(node, "name");
  if (unicode) {
    const codePoint = parseInt(unicode, 16);
    if (!isNaN(codePoint)) {
      parts.push(String.fromCodePoint(codePoint));
    } else {
      parts.push(unicode);
    }
  } else if (name) {
    parts.push(`:${name}:`);
  }
}

function handleUlink(node: PONode, children: PONode[], parts: string[]): void {
  const url = getAttr(node, "url") ?? "";
  const text = getText(children) || url;
  parts.push(`[${text}](${url})`);
}

function handleTable(
  children: PONode[],
  parts: string[],
  result: DescriptionResult,
  collector: WarningCollector,
): void {
  const rowNodes = findChildren(children, "row");
  parts.push("\n");

  for (let i = 0; i < rowNodes.length; i++) {
    const rowChildren = rowNodes[i]["row"] as PONode[];
    const entryNodeWrappers = findChildren(rowChildren, "entry");
    const cells: string[] = [];

    for (const entryNode of entryNodeWrappers) {
      const entryChildren = entryNode["entry"] as PONode[];
      const cellParts: string[] = [];
      walkNodes(entryChildren, cellParts, result, collector);
      cells.push(cleanMarkdown(cellParts.join("")).replace(/\n/g, " "));
    }

    parts.push("| " + cells.join(" | ") + " |\n");

    if (i === 0) {
      parts.push("|" + cells.map(() => "---").join("|") + "|\n");
    }
  }

  parts.push("\n");
}

function handleFormula(children: PONode[], parts: string[]): void {
  const formula = getText(children);
  if (!formula) return;
  if (formula.startsWith("\\[") && formula.endsWith("\\]")) {
    parts.push("\n$$\n" + formula.slice(2, -2).trim() + "\n$$\n");
  } else if (formula.startsWith("$") && formula.endsWith("$")) {
    parts.push(formula);
  } else {
    parts.push("$" + formula + "$");
  }
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .trim();
}
