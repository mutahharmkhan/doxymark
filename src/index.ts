export { parse } from "./parser/index.js";
export type {
  ParseResult,
  SymbolIndex,
  SymbolIndexEntry,
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
  DoxygenFriend,
  TemplateParam,
  BaseClassRef,
  DerivedClassRef,
  AccessSection,
  Param,
  TypeRef,
  SymbolRef,
  EnumValue,
  StructMember,
} from "./parser/types.js";
export type { WarningCollector } from "./parser/warnings.js";
export type {
  TemplateSet,
  RenderContext,
  RenderedOutput,
  RenderedFile,
  DirectoryEntry,
} from "./renderer/types.js";
export { render } from "./renderer/renderer.js";
export { markdownTemplates } from "./renderer/templates/markdown.js";
export { fumadocsPreset } from "./renderer/presets/fumadocs.js";
