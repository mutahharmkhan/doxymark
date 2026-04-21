import type {
  DoxygenFunction,
  DoxygenEnum,
  DoxygenTypedef,
  DoxygenMacro,
  DoxygenVariable,
  DoxygenFriend,
  EnumValue,
  Param,
  TemplateParam,
  SourceLocation,
} from "./types.js";
import { parseTypeRef } from "./type-ref.js";
import { parseDescription, parseBriefDescription } from "./description.js";
import type { WarningCollector } from "./warnings.js";
import { createNullCollector } from "./warnings.js";
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

export interface ExtractedMembers {
  functions: DoxygenFunction[];
  enums: DoxygenEnum[];
  typedefs: DoxygenTypedef[];
  macros: DoxygenMacro[];
  variables: DoxygenVariable[];
  friends: DoxygenFriend[];
}

/**
 * Extract members from an array of sectiondef node wrappers.
 * Each wrapper is a PONode with key "sectiondef" → children.
 */
export function extractMembers(
  sectionDefWrappers: PONode[],
  collector?: WarningCollector,
): ExtractedMembers {
  const col = collector ?? createNullCollector();
  const result: ExtractedMembers = {
    functions: [],
    enums: [],
    typedefs: [],
    macros: [],
    variables: [],
    friends: [],
  };

  for (const wrapper of sectionDefWrappers) {
    const sectionChildren = wrapper["sectiondef"] as PONode[];
    if (!sectionChildren) continue;

    const memberNodes = findChildren(sectionChildren, "memberdef");
    if (memberNodes.length === 0) continue;

    for (const memberNode of memberNodes) {
      const mChildren = memberNode["memberdef"] as PONode[];
      const kind = getAttr(memberNode, "kind") ?? "";

      switch (kind) {
        case "function":
          result.functions.push(extractFunction(memberNode, mChildren, col));
          break;
        case "enum":
          result.enums.push(extractEnum(memberNode, mChildren, col));
          break;
        case "typedef":
          result.typedefs.push(extractTypedef(memberNode, mChildren, col));
          break;
        case "define":
          result.macros.push(extractMacro(memberNode, mChildren, col));
          break;
        case "variable":
          result.variables.push(extractVariable(memberNode, mChildren, col));
          break;
        case "friend":
          result.friends.push(extractFriend(memberNode, mChildren, col));
          break;
        case "signal":
        case "slot":
        case "property":
        case "event":
        case "dcop":
        case "prototype":
        case "interface":
        case "service":
          col.warn(`Skipping unsupported member kind "${kind}": ${getText(getChild(mChildren, "name") ?? [])}`);
          break;
        default:
          col.warn(`Unknown member kind: ${kind}`);
          break;
      }
    }
  }

  return result;
}

function extractFunction(
  node: PONode,
  children: PONode[],
  collector: WarningCollector,
): DoxygenFunction {
  const name = getText(getChild(children, "name") ?? []);
  const id = getAttr(node, "id") ?? "";
  const isStatic = getAttr(node, "static") === "yes";
  const returnType = parseTypeRef(getChild(children, "type"));

  // Parse params
  const params = extractParams(children);

  // Parse descriptions
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  // Cross-reference param descriptions from <parameterlist>
  for (const param of params) {
    const paramDesc = desc.paramDescriptions.get(param.name);
    if (paramDesc) {
      param.description = paramDesc;
    }
    const direction = desc.paramDirections.get(param.name);
    if (direction) {
      param.direction = direction;
    }
  }

  // C++ attributes
  const isConst = getAttr(node, "const") === "yes" ? true : undefined;
  const isConstexpr = getAttr(node, "constexpr") === "yes" ? true : undefined;
  const isNoexcept = getAttr(node, "noexcept") === "yes" ? true : undefined;
  const isVolatile = getAttr(node, "volatile") === "yes" ? true : undefined;
  const isInline = getAttr(node, "inline") === "yes" ? true : undefined;
  const isExplicit = getAttr(node, "explicit") === "yes" ? true : undefined;
  const isFinal = getAttr(node, "final") === "yes" ? true : undefined;
  const isNodiscard = getAttr(node, "nodiscard") === "yes" ? true : undefined;

  const virtStr = getAttr(node, "virt") ?? "non-virtual";
  const virtualKind =
    virtStr === "virtual" || virtStr === "pure-virtual"
      ? (virtStr as "virtual" | "pure-virtual")
      : undefined;

  const protStr = getAttr(node, "prot") ?? "";
  const protection =
    protStr === "public" || protStr === "protected" || protStr === "private"
      ? protStr
      : undefined;

  const argsstringChildren = getChild(children, "argsstring");
  const argsstring = argsstringChildren
    ? getText(argsstringChildren) || undefined
    : undefined;
  const definitionChildren = getChild(children, "definition");
  const definition = definitionChildren
    ? getText(definitionChildren) || undefined
    : undefined;

  // Template params
  const templateParams = extractTemplateParams(
    getChild(children, "templateparamlist"),
    desc,
    collector,
  );

  // Inbody description
  const inbodyChildren = getChild(children, "inbodydescription");
  const inbodyDesc = inbodyChildren
    ? parseDescription(inbodyChildren, collector)
    : undefined;

  return {
    name,
    id,
    returnType,
    params,
    brief,
    description: desc.markdown,
    returnDescription: desc.returnDescription,
    inbodyDescription: inbodyDesc?.markdown || undefined,
    retvalDescriptions: desc.retvalDescriptions,
    exceptions: desc.exceptionDescriptions,
    notes: desc.notes,
    warnings: desc.warnings,
    since: desc.since,
    deprecated: desc.deprecated,
    seeAlso: desc.seeAlso,
    isStatic,
    additionalSections: desc.additionalSections,
    location: extractLocation(children),
    isConst,
    isConstexpr,
    isNoexcept,
    isVolatile,
    isInline,
    isExplicit,
    virtualKind,
    isFinal,
    isNodiscard,
    protection,
    argsstring,
    definition,
    templateParams,
  };
}

function extractParams(memberChildren: PONode[]): Param[] {
  const paramWrappers = findChildren(memberChildren, "param");
  if (paramWrappers.length === 0) return [];
  const params: Param[] = [];

  for (const paramWrapper of paramWrappers) {
    const pChildren = paramWrapper["param"] as PONode[];
    const name = getText(getChild(pChildren, "declname") ?? getChild(pChildren, "defname") ?? []);
    const type = parseTypeRef(getChild(pChildren, "type"));
    const defvalChildren = getChild(pChildren, "defval");
    const defaultValue = defvalChildren
      ? extractTextContent(defvalChildren)
      : undefined;

    // Filter void-only params: skip if name is empty and type is "void"
    if (!name && type.text === "void") continue;

    params.push({
      name,
      type,
      description: "",
      defaultValue,
    });
  }

  return params;
}

function extractTemplateParams(
  templateParamChildren: PONode[] | undefined,
  desc: { templateParamDescriptions: Map<string, string> },
  collector: WarningCollector,
): TemplateParam[] | undefined {
  if (!templateParamChildren || !Array.isArray(templateParamChildren)) return undefined;

  const paramWrappers = findChildren(templateParamChildren, "param");
  if (paramWrappers.length === 0) return undefined;
  const result: TemplateParam[] = [];

  for (const paramWrapper of paramWrappers) {
    const pChildren = paramWrapper["param"] as PONode[];
    const type = parseTypeRef(getChild(pChildren, "type"));
    const name = getText(getChild(pChildren, "declname") ?? getChild(pChildren, "defname") ?? []);
    const defvalChildren = getChild(pChildren, "defval");
    const defaultValue = defvalChildren
      ? extractTextContent(defvalChildren)
      : undefined;
    const description = desc.templateParamDescriptions.get(name) ?? "";

    result.push({ type, name, defaultValue, description });
  }

  return result.length > 0 ? result : undefined;
}

function extractEnum(
  node: PONode,
  children: PONode[],
  collector: WarningCollector,
): DoxygenEnum {
  const name = getText(getChild(children, "name") ?? []);
  const id = getAttr(node, "id") ?? "";
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  const values: EnumValue[] = [];
  const valWrappers = findChildren(children, "enumvalue");
  for (const valWrapper of valWrappers) {
    const vChildren = valWrapper["enumvalue"] as PONode[];
    const valBrief = parseBriefDescription(getChild(vChildren, "briefdescription"), collector);
    const valDesc = parseDescription(getChild(vChildren, "detaileddescription"), collector);

    const initChildren = getChild(vChildren, "initializer");
    const initializer = initChildren
      ? extractTextContent(initChildren)
      : undefined;

    values.push({
      name: getText(getChild(vChildren, "name") ?? []),
      id: getAttr(valWrapper, "id") ?? "",
      brief: valBrief,
      description: valDesc.markdown,
      initializer,
    });
  }

  return {
    name,
    id,
    brief,
    description: desc.markdown,
    values,
    additionalSections: desc.additionalSections,
    location: extractLocation(children),
  };
}

function extractTypedef(
  node: PONode,
  children: PONode[],
  collector: WarningCollector,
): DoxygenTypedef {
  const name = getText(getChild(children, "name") ?? []);
  const id = getAttr(node, "id") ?? "";
  const type = parseTypeRef(getChild(children, "type"));
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  const definitionChildren = getChild(children, "definition");
  const definition = definitionChildren
    ? getText(definitionChildren) || undefined
    : undefined;
  const argsstringChildren = getChild(children, "argsstring");
  const argsstring = argsstringChildren
    ? getText(argsstringChildren) || undefined
    : undefined;

  return {
    name,
    id,
    type,
    definition,
    argsstring,
    brief,
    description: desc.markdown,
    additionalSections: desc.additionalSections,
    location: extractLocation(children),
  };
}

function extractMacro(
  node: PONode,
  children: PONode[],
  collector: WarningCollector,
): DoxygenMacro {
  const name = getText(getChild(children, "name") ?? []);
  const id = getAttr(node, "id") ?? "";
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  let params: string[] | undefined;
  const macroParamWrappers = findChildren(children, "param");
  if (macroParamWrappers.length > 0) {
    params = macroParamWrappers.map((pw) => {
      const pChildren = pw["param"] as PONode[];
      return getText(getChild(pChildren, "defname") ?? getChild(pChildren, "declname") ?? []);
    });
  }

  const initChildren = getChild(children, "initializer");
  const initializer = initChildren
    ? extractTextContent(initChildren)
    : undefined;

  return {
    name,
    id,
    params,
    paramDescriptions: desc.paramDescriptions.size > 0 ? desc.paramDescriptions : undefined,
    initializer,
    brief,
    description: desc.markdown,
    returnDescription: desc.returnDescription || undefined,
    retvalDescriptions: desc.retvalDescriptions.size > 0 ? desc.retvalDescriptions : undefined,
    notes: desc.notes.length > 0 ? desc.notes : undefined,
    warnings: desc.warnings.length > 0 ? desc.warnings : undefined,
    since: desc.since,
    deprecated: desc.deprecated,
    seeAlso: desc.seeAlso.length > 0 ? desc.seeAlso : undefined,
    additionalSections: desc.additionalSections,
    location: extractLocation(children),
  };
}

function extractVariable(
  node: PONode,
  children: PONode[],
  collector: WarningCollector,
): DoxygenVariable {
  const name = getText(getChild(children, "name") ?? []);
  const id = getAttr(node, "id") ?? "";
  const type = parseTypeRef(getChild(children, "type"));
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  return {
    name,
    id,
    type,
    brief,
    description: desc.markdown,
    additionalSections: desc.additionalSections,
    location: extractLocation(children),
  };
}

function extractFriend(
  node: PONode,
  children: PONode[],
  collector: WarningCollector,
): DoxygenFriend {
  const name = getText(getChild(children, "name") ?? []);
  const id = getAttr(node, "id") ?? "";
  const type = parseTypeRef(getChild(children, "type"));
  const brief = parseBriefDescription(getChild(children, "briefdescription"), collector);
  const desc = parseDescription(getChild(children, "detaileddescription"), collector);

  return { name, id, type, brief, description: desc.markdown };
}

function extractLocation(children: PONode[]): SourceLocation | undefined {
  const locNode = findChild(children, "location");
  if (!locNode) return undefined;
  const rawFile = getAttr(locNode, "file") ?? "";
  const line = parseInt(getAttr(locNode, "line") ?? "0", 10);
  if (!rawFile) return undefined;
  // Normalize absolute paths — extract relative path from /src/ onward
  const srcMatch = rawFile.match(/\/src\/(.+)$/);
  const file = srcMatch ? srcMatch[1] : rawFile;
  const bodyStart = getAttr(locNode, "bodystart")
    ? parseInt(getAttr(locNode, "bodystart")!, 10)
    : undefined;
  const bodyEnd = getAttr(locNode, "bodyend")
    ? parseInt(getAttr(locNode, "bodyend")!, 10)
    : undefined;
  return { file, line, bodyStart, bodyEnd };
}

/**
 * Extract text content from a preserveOrder node array, handling mixed
 * text and ref elements. With preserveOrder we simply iterate in order.
 */
function extractTextContent(nodes: PONode[]): string {
  if (!nodes || !Array.isArray(nodes)) return "";
  const parts: string[] = [];
  for (const node of nodes) {
    const tag = getTagName(node);
    if (tag === "#text") {
      parts.push(String(node["#text"]));
    } else if (tag === "ref") {
      const refChildren = node["ref"] as PONode[];
      parts.push(getText(refChildren));
    }
  }
  return parts.join("").trim();
}

export { extractTemplateParams };
