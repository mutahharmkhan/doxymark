// ── Top-level output ──

export interface ParseResult {
  compounds: DoxygenCompound[];
  files: DoxygenFile[];
  index: SymbolIndex;
  warnings: string[];
}

export type SymbolIndex = Record<string, SymbolIndexEntry>;

export interface SymbolIndexEntry {
  path: string;
  anchor: string;
  kind: string;
}

// ── Include / Location / Group types ──

export interface IncludeRef {
  name: string;
  refid?: string;
  local: boolean;
  path?: string;
}

export interface SourceLocation {
  file: string;
  line: number;
  bodyStart?: number;
  bodyEnd?: number;
}

export interface MemberGroup {
  header: string;
  description?: string;
}

// ── Compound types ──

export type DoxygenCompound =
  | DoxygenFile
  | DoxygenClassCompound
  | DoxygenNamespaceCompound
  | DoxygenGroupCompound
  | DoxygenPageCompound;

// ── File (one per header) ──

export interface DoxygenFile {
  kind: "file";
  name: string;
  compoundId: string;
  path: string;
  brief: string;
  description: string;
  functions: DoxygenFunction[];
  enums: DoxygenEnum[];
  structs: DoxygenStruct[];
  typedefs: DoxygenTypedef[];
  macros: DoxygenMacro[];
  variables: DoxygenVariable[];
  includes: IncludeRef[];
  includedby: IncludeRef[];
  location?: SourceLocation;
  memberGroups: MemberGroup[];
}

// ── Class compound ──

export interface DoxygenClassCompound {
  kind: "class";
  name: string;
  compoundId: string;
  path: string;
  brief: string;
  description: string;
  templateParams?: TemplateParam[];
  baseClasses: BaseClassRef[];
  derivedClasses: DerivedClassRef[];
  accessSections: AccessSection[];
  friends: DoxygenFriend[];
  isAbstract?: boolean;
  additionalSections: Record<string, string[]>;
}

export interface TemplateParam {
  type: TypeRef;
  name: string;
  defaultValue?: string;
  description: string;
}

export interface BaseClassRef {
  name: string;
  refid?: string;
  protection: "public" | "protected" | "private";
  virtual: boolean;
}

export interface DerivedClassRef {
  name: string;
  refid?: string;
}

export interface AccessSection {
  access: "public" | "protected" | "private";
  functions: DoxygenFunction[];
  variables: DoxygenVariable[];
  typedefs: DoxygenTypedef[];
  enums: DoxygenEnum[];
}

export interface DoxygenFriend {
  name: string;
  id: string;
  type: TypeRef;
  brief: string;
  description: string;
}

// ── Namespace compound ──

export interface DoxygenNamespaceCompound {
  kind: "namespace";
  name: string;
  compoundId: string;
  path: string;
  brief: string;
  description: string;
  functions: DoxygenFunction[];
  enums: DoxygenEnum[];
  structs: DoxygenStruct[];
  typedefs: DoxygenTypedef[];
  variables: DoxygenVariable[];
  namespaces: string[];
  additionalSections: Record<string, string[]>;
  memberGroups: MemberGroup[];
}

// ── Members ──

export interface DoxygenFunction {
  name: string;
  id: string;
  returnType: TypeRef;
  params: Param[];
  brief: string;
  description: string;
  returnDescription: string;
  retvalDescriptions: Map<string, string>;
  exceptions: Map<string, string>;
  notes: string[];
  warnings: string[];
  since?: string;
  deprecated?: string;
  seeAlso: string[];
  isStatic: boolean;
  additionalSections: Record<string, string[]>;
  inbodyDescription?: string;
  location?: SourceLocation;
  group?: string;
  references?: SymbolRef[];
  referencedby?: SymbolRef[];
  // C++ attributes
  isConst?: boolean;
  isConstexpr?: boolean;
  isNoexcept?: boolean;
  isVolatile?: boolean;
  isInline?: boolean;
  isExplicit?: boolean;
  virtualKind?: "non-virtual" | "virtual" | "pure-virtual";
  isFinal?: boolean;
  isNodiscard?: boolean;
  protection?: "public" | "protected" | "private";
  argsstring?: string;
  definition?: string;
  templateParams?: TemplateParam[];
}

export interface Param {
  name: string;
  type: TypeRef;
  description: string;
  defaultValue?: string;
  direction?: "in" | "out" | "inout";
}

export interface TypeRef {
  text: string;
  refs: SymbolRef[];
}

export interface SymbolRef {
  name: string;
  refid: string;
  path?: string;
}

// ── Enum ──

export interface DoxygenEnum {
  name: string;
  id: string;
  brief: string;
  description: string;
  values: EnumValue[];
  additionalSections: Record<string, string[]>;
  location?: SourceLocation;
  group?: string;
}

export interface EnumValue {
  name: string;
  id: string;
  brief: string;
  description: string;
  initializer?: string;
}

// ── Struct ──

export interface DoxygenStruct {
  name: string;
  id: string;
  brief: string;
  description: string;
  members: StructMember[];
  functions: DoxygenFunction[];
  additionalSections: Record<string, string[]>;
  location?: SourceLocation;
  group?: string;
}

export interface StructMember {
  name: string;
  type: TypeRef;
  argsstring?: string;
  brief: string;
  description: string;
}

// ── Typedef ──

export interface DoxygenTypedef {
  name: string;
  id: string;
  type: TypeRef;
  definition?: string;
  argsstring?: string;
  brief: string;
  description: string;
  additionalSections: Record<string, string[]>;
  location?: SourceLocation;
  group?: string;
}

// ── Macro ──

export interface DoxygenMacro {
  name: string;
  id: string;
  params?: string[];
  paramDescriptions?: Map<string, string>;
  initializer?: string;
  brief: string;
  description: string;
  returnDescription?: string;
  retvalDescriptions?: Map<string, string>;
  notes?: string[];
  warnings?: string[];
  since?: string;
  deprecated?: string;
  seeAlso?: string[];
  additionalSections: Record<string, string[]>;
  location?: SourceLocation;
  group?: string;
}

// ── Variable ──

export interface DoxygenVariable {
  name: string;
  id: string;
  type: TypeRef;
  brief: string;
  description: string;
  additionalSections: Record<string, string[]>;
  location?: SourceLocation;
  group?: string;
}

// ── Group compound ──

export interface DoxygenGroupCompound {
  kind: "group";
  name: string;
  compoundId: string;
  path: string;
  title: string;
  brief: string;
  description: string;
  functions: DoxygenFunction[];
  enums: DoxygenEnum[];
  structs: DoxygenStruct[];
  typedefs: DoxygenTypedef[];
  macros: DoxygenMacro[];
  variables: DoxygenVariable[];
  innerGroups: string[];
  additionalSections: Record<string, string[]>;
  memberGroups: MemberGroup[];
}

// ── Page compound ──

export interface DoxygenPageCompound {
  kind: "page";
  name: string;
  compoundId: string;
  path: string;
  title: string;
  brief: string;
  description: string;
}
