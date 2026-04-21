import type { TypeRef, SymbolRef } from "./types.js";
import type { PONode } from "./xml-helpers.js";
import { getTagName, getAttr, getText } from "./xml-helpers.js";

/**
 * Parse a type element that may contain mixed text and <ref> children.
 *
 * With preserveOrder, the parser emits an ordered array:
 *   XML: `<type>const <ref refid="x">lv_obj_t</ref> *</type>`
 *   Parsed: [{"#text":"const "}, {"ref":[{"#text":"lv_obj_t"}], ":@":{"@_refid":"x"}}, {"#text":" *"}]
 *
 * We simply iterate in order — no more rebuildTypeText heuristic needed.
 */
export function parseTypeRef(typeNode: unknown): TypeRef {
  if (typeNode === undefined || typeNode === null) {
    return { text: "", refs: [] };
  }

  if (typeof typeNode === "string") {
    return { text: typeNode.trim(), refs: [] };
  }

  if (typeof typeNode === "number") {
    return { text: String(typeNode), refs: [] };
  }

  if (!Array.isArray(typeNode)) {
    return { text: String(typeNode), refs: [] };
  }

  const nodes = typeNode as PONode[];
  const refs: SymbolRef[] = [];
  const textParts: string[] = [];

  for (const node of nodes) {
    const tag = getTagName(node);

    if (tag === "#text") {
      textParts.push(String(node["#text"]));
    } else if (tag === "ref") {
      const children = node[tag] as PONode[];
      const name = getText(children);
      const refid = getAttr(node, "refid") ?? "";
      if (name) {
        refs.push({ name, refid });
        textParts.push(name);
      }
    }
    // Ignore other tags in type context
  }

  return { text: textParts.join("").trim(), refs };
}
