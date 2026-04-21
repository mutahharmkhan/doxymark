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
  SymbolIndex,
  SymbolRef,
  IncludeRef,
  SourceLocation,
  MemberGroup,
} from "../parser/types.js";
import type { AnalysisResult, TypeUsageEntry } from "../analyzer/types.js";

export interface DirectoryEntry {
  fileName: string;
  title: string;
  kind: string;
  /** True if this entry represents a subdirectory rather than a leaf file */
  isDirectory?: boolean;
}

export interface ApiCounts {
  functions: number;
  enums: number;
  structs: number;
  typedefs: number;
  macros: number;
  variables: number;
}

export interface DirectoryIndexEntry {
  fileName: string;
  title: string;
  kind: string;
  brief: string;
  counts: ApiCounts;
  /** True if this entry represents a subdirectory rather than a leaf file */
  isDirectory?: boolean;
}

export interface TemplateSet {
  extension: ".md" | ".mdx";
  page(file: DoxygenFile, renderedSections: string): string;
  classPage(cls: DoxygenClassCompound, renderedSections: string, ctx: RenderContext): string;
  namespacePage(ns: DoxygenNamespaceCompound, renderedSections: string, ctx: RenderContext): string;
  function(this: TemplateSet, fn: DoxygenFunction, ctx: RenderContext): string;
  enum(this: TemplateSet, en: DoxygenEnum, ctx: RenderContext): string;
  struct(this: TemplateSet, st: DoxygenStruct, ctx: RenderContext): string;
  macro(this: TemplateSet, mac: DoxygenMacro, ctx: RenderContext): string;
  typedef(this: TemplateSet, td: DoxygenTypedef, ctx: RenderContext): string;
  variable(this: TemplateSet, v: DoxygenVariable, ctx: RenderContext): string;
  friend(this: TemplateSet, f: DoxygenFriend, ctx: RenderContext): string;
  groupPage(group: DoxygenGroupCompound, renderedSections: string, ctx: RenderContext): string;
  docsPage(page: DoxygenPageCompound): string;
  symbolRef(ref: SymbolRef, displayText?: string): string;
  sectionHeading(title: string, level: number): string;
  anchor(id: string): string;
  includesList?(includes: IncludeRef[], includedby: IncludeRef[], transitiveIncludes?: Set<string>): string;
  memberGroupHeading?(group: MemberGroup): string;
  memberGroupStart?(group: MemberGroup): string;
  memberGroupEnd?(): string;
  memberWrapper?(kind: string, name: string, content: string, sourceInfo?: { file: string; line: number; url: string }): string;
  functionGroupTabs?(groups: FunctionGroup[], ctx: RenderContext): string;
  directoryMeta?(dirPath: string, entries: DirectoryEntry[]): RenderedFile | null;
  apiSummary?(counts: ApiCounts): string;
  typeUsedBy?(typeName: string, entries: TypeUsageEntry[]): string;
  callbackSignature?(name: string, signature: string): string;
  relatedHeaders?(currentName: string, pairedPath: string, currentIsPrivate: boolean): string;
  sourceLink?(location: SourceLocation, baseUrl: string): string;
  /** Render a cross-reference link in description text. display is the visible text, path is the resolved page path with optional #anchor. */
  descriptionLink(display: string, path: string): string;
  directoryIndex?(dirPath: string, entries: DirectoryIndexEntry[], context?: DirectoryIndexContext): RenderedFile | null;
}

export interface RenderContext {
  file: DoxygenFile;
  index: SymbolIndex;
  analysis?: AnalysisResult;
}

export interface DirectoryIndexContext {
  introContent?: string;
  totalCounts?: ApiCounts;
}

export interface RenderOptions {
  autoGroupFunctions?: boolean;
  sourceUrlBase?: string;
  rootIntroContent?: string;
}

export interface FunctionGroup {
  label: string;
  rendered: string[];
}

export interface RenderedFile {
  path: string;
  content: string;
}

export interface RenderedOutput {
  files: RenderedFile[];
}
