import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type {
  DoxygenFile,
  DoxygenStruct,
  DoxygenClassCompound,
  DoxygenNamespaceCompound,
  DoxygenGroupCompound,
  DoxygenPageCompound,
  StructMember,
  AccessSection,
  BaseClassRef,
  DerivedClassRef,
  DoxygenFriend,
  TemplateParam,
  IncludeRef,
  SourceLocation,
  MemberGroup,
} from "./types.js";
import { extractMembers, extractTemplateParams } from "./members.js";
import { parseBriefDescription, parseDescription } from "./description.js";
import { parseTypeRef } from "./type-ref.js";
import type { IndexEntry } from "./index.js";
import type { WarningCollector } from "./warnings.js";
import { createNullCollector } from "./warnings.js";
import type { PONode } from "./xml-helpers.js";
import {
  getChild,
  getChildren,
  findChild,
  findChildren,
  getAttr,
  getText,
} from "./xml-helpers.js";

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  numberParseOptions: { hex: false, leadingZeros: false },
});

/**
 * Read and return the compounddef children and its wrapper node from an XML file.
 */
function readCompoundDef(inputDir: string, refid: string): { children: PONode[]; node: PONode } {
  const xmlPath = join(inputDir, `${refid}.xml`);
  const xml = readFileSync(xmlPath, "utf-8");
  const doc = xmlParser.parse(xml) as PONode[];

  const doxygenChildren = getChild(doc, "doxygen");
  if (!doxygenChildren) {
    throw new Error(`No doxygen root in ${xmlPath}`);
  }

  const compoundDefNode = findChild(doxygenChildren, "compounddef");
  if (!compoundDefNode) {
    throw new Error(`No compounddef found in ${xmlPath}`);
  }

  return {
    children: compoundDefNode["compounddef"] as PONode[],
    node: compoundDefNode,
  };
}

export function parseCompound(
  inputDir: string,
  refid: string,
  structEntries: Map<string, IndexEntry>,
  collector?: WarningCollector,
): DoxygenFile {
  const col = collector ?? createNullCollector();
  const { children, node } = readCompoundDef(inputDir, refid);

  const name = getText(getChild(children, "compoundname") ?? []);
  const id = getAttr(node, "id") ?? refid;

  const locationNode = findChild(children, "location");
  const filePath = deriveFilePath(name, locationNode);

  const brief = parseBriefDescription(getChild(children, "briefdescription"), col);
  const desc = parseDescription(getChild(children, "detaileddescription"), col);

  const sectionWrappers = findChildren(children, "sectiondef");
  const { members, memberGroups } = extractMembersWithGroups(sectionWrappers, col);

  const structs = parseInnerClasses(inputDir, children, structEntries, col);

  // Extract includes and includedby
  const includes = extractIncludeRefs(children, "includes");
  const includedby = extractIncludeRefs(children, "includedby");

  // Extract compound-level location
  const location = extractSourceLocation(locationNode);

  return {
    kind: "file",
    name: extractFileName(name),
    compoundId: id,
    path: filePath,
    brief,
    description: desc.markdown,
    functions: members.functions,
    enums: members.enums,
    structs,
    typedefs: members.typedefs,
    macros: members.macros,
    variables: members.variables,
    includes,
    includedby,
    location,
    memberGroups,
  };
}

export function parseClassCompound(
  inputDir: string,
  refid: string,
  collector: WarningCollector,
): DoxygenClassCompound {
  const { children, node } = readCompoundDef(inputDir, refid);

  const name = getText(getChild(children, "compoundname") ?? []);
  const id = getAttr(node, "id") ?? refid;
  const isAbstract = getAttr(node, "abstract") === "yes" ? true : undefined;

  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  // Template params
  const templateParams = extractTemplateParams(
    getChild(children, "templateparamlist"),
    desc,
    collector,
  );

  // Base classes
  const baseClasses = extractBaseClasses(children);

  // Derived classes
  const derivedClasses = extractDerivedClasses(children);

  // Extract access sections
  const accessSections = extractAccessSections(children, collector);

  // Extract friends from friend sections
  const friends = extractFriendsFromSections(children, collector);

  // Path derivation
  const locationNode = findChild(children, "location");
  const filePath = deriveClassPath(name, locationNode);

  return {
    kind: "class",
    name,
    compoundId: id,
    path: filePath,
    brief,
    description: desc.markdown,
    templateParams,
    baseClasses,
    derivedClasses,
    accessSections,
    friends,
    isAbstract,
    additionalSections: desc.additionalSections,
  };
}

export function parseNamespaceCompound(
  inputDir: string,
  refid: string,
  structEntries: Map<string, IndexEntry>,
  collector: WarningCollector,
): DoxygenNamespaceCompound {
  const { children, node } = readCompoundDef(inputDir, refid);

  const name = getText(getChild(children, "compoundname") ?? []);
  const id = getAttr(node, "id") ?? refid;

  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  // Extract members from sectiondefs
  const sectionWrappers = findChildren(children, "sectiondef");
  const { members, memberGroups } = extractMembersWithGroups(sectionWrappers, collector);

  // Inner structs
  const structs = parseInnerClasses(inputDir, children, structEntries, collector);

  // Inner namespaces
  const namespaces: string[] = [];
  const nsNodes = findChildren(children, "innernamespace");
  for (const nsNode of nsNodes) {
    const nsChildren = nsNode["innernamespace"] as PONode[];
    const nsName = getText(nsChildren);
    if (nsName) namespaces.push(nsName);
  }

  // Path derivation: namespace name with :: → /
  const filePath = name.replace(/::/g, "/");

  return {
    kind: "namespace",
    name,
    compoundId: id,
    path: filePath,
    brief,
    description: desc.markdown,
    functions: members.functions,
    enums: members.enums,
    structs,
    typedefs: members.typedefs,
    variables: members.variables,
    namespaces,
    additionalSections: desc.additionalSections,
    memberGroups,
  };
}

export function parseGroupCompound(
  inputDir: string,
  refid: string,
  structEntries: Map<string, IndexEntry>,
  collector: WarningCollector,
): DoxygenGroupCompound {
  const { children, node } = readCompoundDef(inputDir, refid);

  const name = getText(getChild(children, "compoundname") ?? []);
  const id = getAttr(node, "id") ?? refid;
  const titleChildren = getChild(children, "title");
  const title = titleChildren ? getText(titleChildren) || name : name;

  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  // Extract members
  const sectionWrappers = findChildren(children, "sectiondef");
  const { members, memberGroups } = extractMembersWithGroups(sectionWrappers, collector);

  // Inner structs
  const structs = parseInnerClasses(inputDir, children, structEntries, collector);

  // Inner groups
  const innerGroups: string[] = [];
  const groupNodes = findChildren(children, "innergroup");
  for (const gNode of groupNodes) {
    const gChildren = gNode["innergroup"] as PONode[];
    const gName = getText(gChildren);
    if (gName) innerGroups.push(gName);
  }

  // Path: sanitized group name
  const filePath = name.replace(/[^a-zA-Z0-9_/-]/g, "_");

  return {
    kind: "group",
    name,
    compoundId: id,
    path: filePath,
    title,
    brief,
    description: desc.markdown,
    functions: members.functions,
    enums: members.enums,
    structs,
    typedefs: members.typedefs,
    macros: members.macros,
    variables: members.variables,
    innerGroups,
    additionalSections: desc.additionalSections,
    memberGroups,
  };
}

export function parsePageCompound(
  inputDir: string,
  refid: string,
  collector: WarningCollector,
): DoxygenPageCompound {
  const { children, node } = readCompoundDef(inputDir, refid);

  const name = getText(getChild(children, "compoundname") ?? []);
  const id = getAttr(node, "id") ?? refid;
  const titleChildren = getChild(children, "title");
  const title = titleChildren ? getText(titleChildren) || name : name;

  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  // Path: sanitized page name
  const filePath = name.replace(/[^a-zA-Z0-9_/-]/g, "_");

  return {
    kind: "page",
    name,
    compoundId: id,
    path: filePath,
    title,
    brief,
    description: desc.markdown,
  };
}

// ── Internal helpers ──

function extractBaseClasses(children: PONode[]): BaseClassRef[] {
  const refNodes = findChildren(children, "basecompoundref");
  if (refNodes.length === 0) return [];
  return refNodes.map((refNode) => {
    const refChildren = refNode["basecompoundref"] as PONode[];
    const name = getText(refChildren);
    const refid = getAttr(refNode, "refid");
    const prot = getAttr(refNode, "prot") ?? "public";
    const virt = getAttr(refNode, "virt") ?? "non-virtual";
    return {
      name,
      refid,
      protection: (prot === "protected" || prot === "private" ? prot : "public") as
        "public" | "protected" | "private",
      virtual: virt === "virtual",
    };
  });
}

function extractDerivedClasses(children: PONode[]): DerivedClassRef[] {
  const refNodes = findChildren(children, "derivedcompoundref");
  if (refNodes.length === 0) return [];
  return refNodes.map((refNode) => {
    const refChildren = refNode["derivedcompoundref"] as PONode[];
    return {
      name: getText(refChildren),
      refid: getAttr(refNode, "refid"),
    };
  });
}

/** Known non-access sectiondef kinds that don't need a warning */
const KNOWN_NON_ACCESS_KINDS = new Set([
  "friend", "related", "user-defined",
  "func", "enum", "typedef", "define", "var",
  "signal", "dcop-func", "property", "event",
]);

/** Map sectiondef @_kind to access level */
function sectionKindToAccess(kind: string): "public" | "protected" | "private" | null {
  if (kind.startsWith("public")) return "public";
  if (kind.startsWith("protected")) return "protected";
  if (kind.startsWith("private")) return "private";
  if (kind.startsWith("package-")) return "public"; // Java package-private → public in C++ context
  return null;
}

function extractAccessSections(
  children: PONode[],
  collector: WarningCollector,
): AccessSection[] {
  const sectionWrappers = findChildren(children, "sectiondef");

  const accessMap = new Map<string, AccessSection>();

  for (const sectionWrapper of sectionWrappers) {
    const kind = getAttr(sectionWrapper, "kind") ?? "";

    // Skip friend sections (handled separately)
    if (kind === "friend") continue;

    const access = sectionKindToAccess(kind);
    if (!access) {
      if (!KNOWN_NON_ACCESS_KINDS.has(kind) && kind) {
        collector.warn(`Unknown sectiondef kind: "${kind}"`);
      }
      continue;
    }

    if (!accessMap.has(access)) {
      accessMap.set(access, {
        access,
        functions: [],
        variables: [],
        typedefs: [],
        enums: [],
      });
    }

    const section_ = accessMap.get(access)!;
    const members = extractMembers([sectionWrapper], collector);
    section_.functions.push(...members.functions);
    section_.variables.push(...members.variables);
    section_.typedefs.push(...members.typedefs);
    section_.enums.push(...members.enums);
  }

  // Return in stable order: public, protected, private
  const result: AccessSection[] = [];
  for (const access of ["public", "protected", "private"] as const) {
    const section = accessMap.get(access);
    if (section) result.push(section);
  }
  return result;
}

function extractFriendsFromSections(
  children: PONode[],
  collector: WarningCollector,
): DoxygenFriend[] {
  const sectionWrappers = findChildren(children, "sectiondef");

  const friends: DoxygenFriend[] = [];
  for (const sectionWrapper of sectionWrappers) {
    const kind = getAttr(sectionWrapper, "kind") ?? "";
    if (kind !== "friend") continue;

    const members = extractMembers([sectionWrapper], collector);
    friends.push(...members.friends);
  }
  return friends;
}

function parseInnerClasses(
  inputDir: string,
  children: PONode[],
  structEntries: Map<string, IndexEntry>,
  collector: WarningCollector,
): DoxygenStruct[] {
  const classWrappers = findChildren(children, "innerclass");
  if (classWrappers.length === 0) return [];
  const structs: DoxygenStruct[] = [];

  for (const icWrapper of classWrappers) {
    const icChildren = icWrapper["innerclass"] as PONode[];
    const refid = getAttr(icWrapper, "refid") ?? "";
    const structName = getText(icChildren);

    if (!refid) continue;

    try {
      const struct = parseStructCompound(inputDir, refid, structName, collector);
      if (struct) {
        structs.push(struct);
      }
    } catch (e) {
      collector.warn(`Failed to parse struct ${structName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return structs;
}

function parseStructCompound(
  inputDir: string,
  refid: string,
  fallbackName: string,
  collector: WarningCollector,
): DoxygenStruct | null {
  const xmlPath = join(inputDir, `${refid}.xml`);
  let xml: string;
  try {
    xml = readFileSync(xmlPath, "utf-8");
  } catch {
    return null;
  }

  const doc = xmlParser.parse(xml) as PONode[];
  const doxygenChildren = getChild(doc, "doxygen");
  if (!doxygenChildren) return null;
  const compoundDefNode = findChild(doxygenChildren, "compounddef");
  if (!compoundDefNode) return null;
  const children = compoundDefNode["compounddef"] as PONode[];

  const name = getText(getChild(children, "compoundname") ?? []) || fallbackName;
  const id = getAttr(compoundDefNode, "id") ?? refid;
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  const structMembers: StructMember[] = [];
  const sectionWrappers = findChildren(children, "sectiondef");
  let extractedFunctions: import("./types.js").DoxygenFunction[] = [];

  if (sectionWrappers.length > 0) {
    // Extract function members via extractMembers
    const extracted = extractMembers(sectionWrappers, collector);
    extractedFunctions = extracted.functions;

    // Extract variable members directly for struct fields
    for (const sectionWrapper of sectionWrappers) {
      const sectionChildren = sectionWrapper["sectiondef"] as PONode[];
      const memberNodes = findChildren(sectionChildren, "memberdef");
      for (const memberNode of memberNodes) {
        const mChildren = memberNode["memberdef"] as PONode[];
        const kind = getAttr(memberNode, "kind") ?? "";
        if (kind !== "variable") continue;

        const memberBrief = parseBriefDescription(getChild(mChildren, "briefdescription"), collector);
        const memberDesc = parseDescription(getChild(mChildren, "detaileddescription"), collector);

        const argsstringChildren = getChild(mChildren, "argsstring");
        const memberArgsstring = argsstringChildren
          ? getText(argsstringChildren) || undefined
          : undefined;

        structMembers.push({
          name: getText(getChild(mChildren, "name") ?? []),
          type: parseTypeRef(getChild(mChildren, "type")),
          argsstring: memberArgsstring,
          brief: memberBrief,
          description: memberDesc.markdown,
        });
      }
    }
  }

  return {
    name,
    id,
    brief,
    description: desc.markdown,
    members: structMembers,
    functions: extractedFunctions,
    additionalSections: desc.additionalSections,
  };
}

function deriveFilePath(
  compoundName: string,
  locationNode: PONode | undefined,
): string {
  if (locationNode) {
    const file = getAttr(locationNode, "file") ?? "";
    const srcMatch = file.match(/\/src\/(.+)$/);
    if (srcMatch) {
      return srcMatch[1];
    }
  }
  return compoundName;
}

function deriveClassPath(
  className: string,
  locationNode: PONode | undefined,
): string {
  if (locationNode) {
    const file = getAttr(locationNode, "file") ?? "";
    const srcMatch = file.match(/\/src\/(.+)$/);
    if (srcMatch) {
      return srcMatch[1];
    }
  }
  // Fallback: derive from class name (replace :: with /)
  return className.replace(/::/g, "/");
}

function extractFileName(compoundName: string): string {
  const parts = compoundName.split("/");
  return parts[parts.length - 1];
}

function extractIncludeRefs(children: PONode[], tagName: "includes" | "includedby"): IncludeRef[] {
  const nodes = findChildren(children, tagName);
  return nodes.map((node) => {
    const nodeChildren = node[tagName] as PONode[];
    const name = getText(nodeChildren);
    const refid = getAttr(node, "refid");
    const local = getAttr(node, "local") === "yes";
    // For includedby, strip absolute path prefix to keep relative name
    const displayName = name.replace(/^.*\/src\//, "").replace(/^.*\//, "");
    return {
      name: displayName || name,
      refid: refid ?? undefined,
      local,
    };
  });
}

function extractSourceLocation(locationNode: PONode | undefined): SourceLocation | undefined {
  if (!locationNode) return undefined;
  const rawFile = getAttr(locationNode, "file") ?? "";
  const line = parseInt(getAttr(locationNode, "line") ?? "0", 10);
  if (!rawFile) return undefined;
  // Normalize absolute paths — extract relative path from /src/ onward
  const srcMatch = rawFile.match(/\/src\/(.+)$/);
  const file = srcMatch ? srcMatch[1] : rawFile;
  const bodyStart = getAttr(locationNode, "bodystart")
    ? parseInt(getAttr(locationNode, "bodystart")!, 10)
    : undefined;
  const bodyEnd = getAttr(locationNode, "bodyend")
    ? parseInt(getAttr(locationNode, "bodyend")!, 10)
    : undefined;
  return { file, line, bodyStart, bodyEnd };
}

/**
 * Extract members with group information from sectiondef wrappers.
 * Checks each sectiondef for a <header> child to identify user-defined groups.
 */
function extractMembersWithGroups(
  sectionDefWrappers: PONode[],
  collector: import("./warnings.js").WarningCollector,
): { members: import("./members.js").ExtractedMembers; memberGroups: MemberGroup[] } {
  const memberGroups: MemberGroup[] = [];
  const allMembers = extractMembers([], collector); // empty starting point

  for (const wrapper of sectionDefWrappers) {
    const sectionChildren = wrapper["sectiondef"] as PONode[];
    const kind = getAttr(wrapper, "kind") ?? "";

    // Check for user-defined group header
    let groupName: string | undefined;
    if (kind === "user-defined" && sectionChildren) {
      const headerNode = findChild(sectionChildren, "header");
      if (headerNode) {
        const headerChildren = headerNode["header"] as PONode[];
        groupName = getText(headerChildren);
        if (groupName) {
          // Check for group description
          const descNode = findChild(sectionChildren, "description");
          const description = descNode ? getText(descNode["description"] as PONode[]) : undefined;
          memberGroups.push({ header: groupName, description: description || undefined });
        }
      }
    }

    const extracted = extractMembers([wrapper], collector);

    // Tag extracted members with group name
    if (groupName) {
      for (const fn of extracted.functions) fn.group = groupName;
      for (const en of extracted.enums) en.group = groupName;
      for (const td of extracted.typedefs) td.group = groupName;
      for (const mac of extracted.macros) mac.group = groupName;
      for (const v of extracted.variables) v.group = groupName;
    }

    allMembers.functions.push(...extracted.functions);
    allMembers.enums.push(...extracted.enums);
    allMembers.typedefs.push(...extracted.typedefs);
    allMembers.macros.push(...extracted.macros);
    allMembers.variables.push(...extracted.variables);
    allMembers.friends.push(...extracted.friends);
  }

  return { members: allMembers, memberGroups };
}
