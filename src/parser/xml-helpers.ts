/**
 * Typed helpers for navigating fast-xml-parser preserveOrder output.
 *
 * With preserveOrder: true, the parser emits arrays of node objects.
 * Each node has a single content key (the tag name) mapping to its children array,
 * plus an optional ":@" key holding attributes.
 *
 * Example:
 *   <para>Hello <ref refid="x">world</ref></para>
 *   →
 *   [{ "para": [{"#text":"Hello "}, {"ref":[{"#text":"world"}], ":@":{"@_refid":"x"}}] }]
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type PONode = { [key: string]: PONode[] | string | Record<string, string> };

/**
 * Get the tag name of a preserveOrder node (the single non-":@" key).
 */
export function getTagName(node: PONode): string {
  for (const key of Object.keys(node)) {
    if (key !== ":@") return key;
  }
  return "";
}

/**
 * Get the children array of the first child element with the given tag.
 * Returns undefined if no such child exists.
 */
export function getChild(nodes: PONode[], tag: string): PONode[] | undefined {
  for (const node of nodes) {
    if (tag in node) {
      return node[tag] as PONode[];
    }
  }
  return undefined;
}

/**
 * Get all children arrays matching a given tag (for repeated elements like sectiondef).
 */
export function getChildren(nodes: PONode[], tag: string): PONode[][] {
  const result: PONode[][] = [];
  for (const node of nodes) {
    if (tag in node) {
      result.push(node[tag] as PONode[]);
    }
  }
  return result;
}

/**
 * Find the wrapper node itself (for accessing its :@ attributes).
 */
export function findChild(nodes: PONode[], tag: string): PONode | undefined {
  for (const node of nodes) {
    if (tag in node) return node;
  }
  return undefined;
}

/**
 * Find all wrapper nodes matching a tag.
 */
export function findChildren(nodes: PONode[], tag: string): PONode[] {
  const result: PONode[] = [];
  for (const node of nodes) {
    if (tag in node) result.push(node);
  }
  return result;
}

/**
 * Get an attribute value from a node's :@ object.
 */
export function getAttr(node: PONode, attr: string): string | undefined {
  const attrs = node[":@"] as Record<string, string> | undefined;
  if (!attrs) return undefined;
  return attrs[`@_${attr}`];
}

/**
 * Get all attributes from a node's :@ object (without the @_ prefix).
 */
export function getAttrs(node: PONode): Record<string, string> {
  const attrs = node[":@"] as Record<string, string> | undefined;
  if (!attrs) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("@_")) {
      result[key.slice(2)] = value;
    }
  }
  return result;
}

/**
 * Concatenate all #text children in a node array into a single string.
 */
export function getText(nodes: PONode[]): string {
  if (!nodes || !Array.isArray(nodes)) return "";
  const parts: string[] = [];
  for (const node of nodes) {
    if ("#text" in node) {
      parts.push(String(node["#text"]));
    }
  }
  return parts.join("");
}

/**
 * Get individual #text values from a node array, preserving order.
 */
export function getTextNodes(nodes: PONode[]): string[] {
  if (!nodes || !Array.isArray(nodes)) return [];
  const result: string[] = [];
  for (const node of nodes) {
    if ("#text" in node) {
      result.push(String(node["#text"]));
    }
  }
  return result;
}
