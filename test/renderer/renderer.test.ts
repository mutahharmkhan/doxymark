import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseIndex, parse } from "../../src/parser/index.js";
import { render, classifyFunction } from "../../src/renderer/renderer.js";
import { markdownTemplates, sanitizeForTableCell, escapePipesOutsideCode, formatTypeRef, cleanAnonymousTypes, renderMacroDefinition } from "../../src/renderer/templates/markdown.js";
import { fumadocsPreset, escapeMdxText, sanitizeForMdxTableCell } from "../../src/renderer/presets/fumadocs.js";
import type { DoxygenTypedef, DoxygenMacro, DoxygenFunction, DoxygenEnum, DoxygenStruct, DoxygenVariable } from "../../src/parser/types.js";
import { resolveDescriptionRefs } from "../../src/parser/symbol-index.js";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures");

describe("renderer", () => {
  it("should render parsed files to markdown", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, markdownTemplates);

    expect(output.files.length).toBeGreaterThan(0);

    for (const file of output.files) {
      expect(file.path).toMatch(/\.md$/);
      expect(file.content).toBeTruthy();
      expect(file.content).toContain("# ");
    }
  });

  it("should render lv_obj.h with functions section", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, markdownTemplates);

    const objFile = output.files.find((f) => f.path.includes("lv_obj"));
    expect(objFile).toBeDefined();
    expect(objFile!.content).toContain("## Functions");
    expect(objFile!.content).toContain("lv_obj_create");
    expect(objFile!.content).toContain("```c");
  });

  it("should render with Fumadocs preset producing MDX", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    expect(output.files.length).toBeGreaterThan(0);

    const mdxFiles = output.files.filter((f) => !f.path.endsWith("meta.json"));
    expect(mdxFiles.length).toBeGreaterThan(0);

    for (const file of mdxFiles) {
      expect(file.path).toMatch(/\.mdx$/);
      expect(file.content).toContain("---");
      expect(file.content).toContain("title:");
    }
  });

  it("should produce anchor tags in markdown", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, markdownTemplates);

    const objFile = output.files.find((f) => f.path.includes("lv_obj"));
    expect(objFile).toBeDefined();
    expect(objFile!.content).toContain('<a id="lv_obj_create"></a>');
  });

  it("should produce ApiMember wrappers with name in Fumadocs preset", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    const objFile = output.files.find((f) => f.path.includes("lv_obj"));
    expect(objFile).toBeDefined();
    expect(objFile!.content).toContain('<ApiMember kind="function" name="lv_obj_create">');
  });
});

describe("markdownTemplates", () => {
  it("should format symbol refs as markdown links when path is available", () => {
    const ref = { name: "lv_obj_t", refid: "test", path: "core/lv_obj_h#lv_obj_t" };
    const result = markdownTemplates.symbolRef(ref);
    expect(result).toBe("[lv_obj_t](core/lv_obj_h#lv_obj_t)");
  });

  it("should format symbol refs as code when path is unavailable", () => {
    const ref = { name: "lv_obj_t", refid: "test" };
    const result = markdownTemplates.symbolRef(ref);
    expect(result).toBe("`lv_obj_t`");
  });

  it("should format section headings", () => {
    expect(markdownTemplates.sectionHeading("Functions", 2)).toBe("## Functions");
    expect(markdownTemplates.sectionHeading("Enums", 3)).toBe("### Enums");
  });
});

describe("fumadocsPreset", () => {
  it("should format symbol refs as ApiLink components", () => {
    const ref = { name: "lv_obj_t", refid: "test", path: "core/lv_obj_h#lv_obj_t" };
    const result = fumadocsPreset.symbolRef(ref);
    expect(result).toBe('<ApiLink name="lv_obj_t" />');
  });

  it("should format anchors as span id", () => {
    expect(fumadocsPreset.anchor("test-id")).toBe('<span id="test-id" />');
  });
});

describe("typedef rendering", () => {
  const dummyCtx = { index: {} } as any;

  it("should use definition for function pointer typedefs", () => {
    const td: DoxygenTypedef = {
      name: "lv_layout_update_cb_t",
      id: "test",
      type: { text: "void(*", refs: [] },
      definition: "typedef void(* lv_layout_update_cb_t) (lv_obj_t *, void *user_data)",
      argsstring: ")(lv_obj_t *, void *user_data)",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.typedef(td, dummyCtx);
    expect(result).toContain("typedef void(* lv_layout_update_cb_t) (lv_obj_t *, void *user_data)");
    // Should NOT duplicate the argsstring
    expect(result).not.toContain("user_data))(");
  });

  it("should fall back to type + name when definition is absent", () => {
    const td: DoxygenTypedef = {
      name: "my_int",
      id: "test",
      type: { text: "int", refs: [] },
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.typedef(td, dummyCtx);
    expect(result).toContain("typedef int my_int");
  });
});

describe("macro rendering", () => {
  const dummyCtx = { index: {} } as any;

  it("should render parameterized macro body with backslash continuation", () => {
    const mac: DoxygenMacro = {
      name: "LV_COLOR_MAKE",
      id: "test",
      params: ["r8", "g8", "b8"],
      initializer: "{b8, g8, r8}",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("#define LV_COLOR_MAKE(r8, g8, b8) \\");
    expect(result).toContain("    {b8, g8, r8}");
    expect(result).not.toContain("//");
  });

  it("should render parameterized macro without body when no initializer", () => {
    const mac: DoxygenMacro = {
      name: "MY_MACRO",
      id: "test",
      params: ["x"],
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("#define MY_MACRO(x)");
    expect(result).not.toContain("\\");
  });
});

describe("sanitizeForTableCell", () => {
  it("should convert fenced code blocks to inline code", () => {
    const input = "Some text\n```c\nlv_label_set_text(label, \"hello\");\n```\nmore text";
    const result = sanitizeForTableCell(input);
    expect(result).not.toContain("```");
    expect(result).toContain('`lv_label_set_text(label, "hello");`');
  });

  it("should replace newlines with <br/>", () => {
    const input = "line one\nline two";
    const result = sanitizeForTableCell(input);
    expect(result).toBe("line one<br/>line two");
  });

  it("should handle multiline code blocks by joining lines", () => {
    const input = "before\n```c\nint a = 1;\nint b = 2;\n```\nafter";
    const result = sanitizeForTableCell(input);
    expect(result).not.toContain("```");
    expect(result).toContain("`int a = 1; int b = 2;`");
  });

  it("should return plain text unchanged", () => {
    const input = "simple description";
    const result = sanitizeForTableCell(input);
    expect(result).toBe("simple description");
  });
});

describe("resolveDescriptionRefs — dxlink placeholder generation", () => {
  it("should resolve backtick-enclosed dxref to dxlink placeholder with stripped backticks", () => {
    const compound: any = {
      kind: "file",
      name: "test.h",
      compoundId: "test_8h",
      path: "test.h",
      brief: "`[lv_obj_flag_t]({{dxref:abc}})`",
      description: "",
      functions: [],
      enums: [],
      structs: [],
      typedefs: [],
      macros: [],
      variables: [],
    };
    const refidMap: Record<string, string> = { abc: "core/lv_obj_h#lv_obj_flag_t" };
    resolveDescriptionRefs([compound], refidMap);
    // Backticks stripped, placeholder emitted for template-controlled rendering
    expect(compound.brief).toBe("`{{dxlink:lv_obj_flag_t|core/lv_obj_h#lv_obj_flag_t}}`");
  });

  it("should resolve plain dxref to dxlink placeholder", () => {
    const compound: any = {
      kind: "file",
      name: "test.h",
      compoundId: "test_8h",
      path: "test.h",
      brief: "See [lv_obj_create]({{dxref:func123}}) for details",
      description: "",
      functions: [],
      enums: [],
      structs: [],
      typedefs: [],
      macros: [],
      variables: [],
    };
    const refidMap: Record<string, string> = { func123: "core/lv_obj_h#lv_obj_create" };
    resolveDescriptionRefs([compound], refidMap);
    expect(compound.brief).toBe("See {{dxlink:lv_obj_create|core/lv_obj_h#lv_obj_create}} for details");
  });

  it("should strip display text when refid is unresolved", () => {
    const compound: any = {
      kind: "file",
      name: "test.h",
      compoundId: "test_8h",
      path: "test.h",
      brief: "See [some_func]({{dxref:unknown}}) here",
      description: "",
      functions: [],
      enums: [],
      structs: [],
      typedefs: [],
      macros: [],
      variables: [],
    };
    resolveDescriptionRefs([compound], {});
    expect(compound.brief).toBe("See some_func here");
  });
});

describe("hasCppAttributes — language tag selection", () => {
  const dummyCtx = { index: {} } as any;

  function makeFn(overrides: Partial<DoxygenFunction> = {}): DoxygenFunction {
    return {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test_func()",
      argsstring: "()",
      ...overrides,
    };
  }

  it("should use ```c for plain C functions", () => {
    const fn = makeFn();
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("```c");
    expect(result).not.toContain("```cpp");
  });

  it("should use ```c for inline functions (inline is valid C99+)", () => {
    const fn = makeFn({ isInline: true });
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("```c");
    expect(result).not.toContain("```cpp");
  });

  it("should use ```c for volatile functions (volatile is valid C)", () => {
    const fn = makeFn({ isVolatile: true });
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("```c");
    expect(result).not.toContain("```cpp");
  });

  it("should use ```cpp for constexpr functions", () => {
    const fn = makeFn({ isConstexpr: true });
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("```cpp");
  });

  it("should use ```cpp for template functions", () => {
    const fn = makeFn({ templateParams: [{ name: "T", type: { text: "typename", refs: [] }, description: "" }] });
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("```cpp");
  });
});

describe("variadic param rendering", () => {
  const dummyCtx = { index: {} } as any;

  it("should render variadic param with name '...' and empty type", () => {
    const fn: DoxygenFunction = {
      name: "printf_like",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [
        { name: "fmt", type: { text: "const char *", refs: [] }, description: "format string" },
        { name: "...", type: { text: "", refs: [] }, description: "variadic args" },
      ],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void printf_like(const char *fmt, ...)",
      argsstring: "(const char *fmt, ...)",
    };
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("| `...` | | variadic args |");
  });

  it("should render variadic param when type is '...' and name is empty", () => {
    const fn: DoxygenFunction = {
      name: "test",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [
        { name: "", type: { text: "...", refs: [] }, description: "" },
      ],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test(...)",
      argsstring: "(...)",
    };
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("| `...` | |");
    // Should NOT have empty backticks for name
    expect(result).not.toContain("| `` |");
  });
});

describe("multi-line macro initializer", () => {
  const dummyCtx = { index: {} } as any;

  it("should render multi-line initializer with backslash continuations (with params)", () => {
    const mac: DoxygenMacro = {
      name: "MY_MACRO",
      id: "test",
      params: ["x"],
      initializer: "(x) ?\n(x + 1) :\n(x - 1)",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("#define MY_MACRO(x) \\");
    expect(result).toContain("    (x) ? \\");
    expect(result).toContain("    (x + 1) : \\");
    expect(result).toContain("    (x - 1)");
    // Last line should NOT have backslash
    expect(result).not.toContain("(x - 1) \\");
  });

  it("should render multi-line initializer without params", () => {
    const mac: DoxygenMacro = {
      name: "BIG_VALUE",
      id: "test",
      initializer: "(a) ?\n(b) :\n(c)",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("#define BIG_VALUE (a) ? \\");
    expect(result).toContain("    (b) : \\");
    expect(result).toContain("    (c)");
    // Last line should NOT have backslash continuation
    expect(result).not.toContain("(c) \\");
  });

  it("should render single-line initializer without params normally", () => {
    const mac: DoxygenMacro = {
      name: "VALUE",
      id: "test",
      initializer: "42",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("#define VALUE 42");
    expect(result).not.toContain("\\");
  });
});

describe("fumadocs Callout rendering", () => {
  const dummyCtx = { index: {} } as any;

  function makeFn(overrides: Partial<DoxygenFunction> = {}): DoxygenFunction {
    return {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test_func()",
      argsstring: "()",
      ...overrides,
    };
  }

  it("should render notes as Callout type info", () => {
    const fn = makeFn({ notes: ["This is a note."] });
    const result = fumadocsPreset.function(fn, dummyCtx);
    expect(result).toContain('<Callout type="info">');
    expect(result).toContain("This is a note.");
    expect(result).toContain("</Callout>");
    expect(result).not.toContain("> **Note:**");
  });

  it("should render warnings as Callout type warn", () => {
    const fn = makeFn({ warnings: ["Be careful!"] });
    const result = fumadocsPreset.function(fn, dummyCtx);
    expect(result).toContain('<Callout type="warn">');
    expect(result).toContain("Be careful!");
    expect(result).toContain("</Callout>");
    expect(result).not.toContain("> **Warning:**");
  });

  it("should render deprecated as Callout type error", () => {
    const fn = makeFn({ deprecated: "Use new_func instead." });
    const result = fumadocsPreset.function(fn, dummyCtx);
    expect(result).toContain('<Callout type="error">');
    expect(result).toContain("**Deprecated:** Use new_func instead.");
    expect(result).toContain("</Callout>");
    expect(result).not.toContain("> **Deprecated:**");
  });

  it("should render multiple notes as separate Callouts", () => {
    const fn = makeFn({ notes: ["First note.", "Second note."] });
    const result = fumadocsPreset.function(fn, dummyCtx);
    const matches = result.match(/<Callout type="info">/g);
    expect(matches).toHaveLength(2);
  });
});

describe("fumadocs additional sections as Callouts", () => {
  const dummyCtx = { index: {} } as any;

  it("should render attention sections as Callout type warn", () => {
    const en: DoxygenEnum = {
      name: "test_enum",
      id: "test",
      brief: "",
      description: "",
      values: [],
      additionalSections: { attention: ["Must init first."] },
    };
    const result = fumadocsPreset.enum(en, dummyCtx);
    expect(result).toContain('<Callout type="warn">');
    expect(result).toContain("**Attention:** Must init first.");
    expect(result).toContain("</Callout>");
    expect(result).not.toContain("> **Attention:**");
  });

  it("should render important sections as Callout type warn", () => {
    const st: DoxygenStruct = {
      name: "test_struct",
      id: "test",
      brief: "",
      description: "",
      members: [],
      additionalSections: { important: ["Do not skip this."] },
    };
    const result = fumadocsPreset.struct(st, dummyCtx);
    expect(result).toContain('<Callout type="warn">');
    expect(result).toContain("**Important:** Do not skip this.");
  });

  it("should render remark sections as Callout type info", () => {
    const v: DoxygenVariable = {
      name: "test_var",
      id: "test",
      type: { text: "int", refs: [] },
      brief: "",
      description: "",
      additionalSections: { remark: ["This is a remark."] },
    };
    const result = fumadocsPreset.variable(v, dummyCtx);
    expect(result).toContain('<Callout type="info">');
    expect(result).toContain("**Remark:** This is a remark.");
  });

  it("should render pre/post/invariant sections as Callout type info", () => {
    const fn: DoxygenFunction = {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {
        pre: ["Object must be initialized."],
        post: ["Object is in ready state."],
        invariant: ["Size is always positive."],
      },
      definition: "void test_func()",
      argsstring: "()",
    };
    const result = fumadocsPreset.function(fn, dummyCtx);
    expect(result).toContain("**Pre:** Object must be initialized.");
    expect(result).toContain("**Post:** Object is in ready state.");
    expect(result).toContain("**Invariant:** Size is always positive.");
    const infoMatches = result.match(/<Callout type="info">/g);
    expect(infoMatches).toHaveLength(3);
  });

  it("should still render additional sections as blockquotes in markdown preset", () => {
    const en: DoxygenEnum = {
      name: "test_enum",
      id: "test",
      brief: "",
      description: "",
      values: [],
      additionalSections: { attention: ["Must init first."] },
    };
    const result = markdownTemplates.enum(en, dummyCtx);
    expect(result).toContain("> **Attention:** Must init first.");
    expect(result).not.toContain("<Callout");
  });
});

describe("fumadocs sanitizes MDX table cells", () => {
  const dummyCtx = { index: {} } as any;

  it("should replace newlines with <br/> in function param descriptions", () => {
    const fn: DoxygenFunction = {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [
        { name: "arg", type: { text: "int", refs: [] }, description: "line one\nline two" },
      ],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test_func(int arg)",
      argsstring: "(int arg)",
    };
    const result = fumadocsPreset.function(fn, dummyCtx);
    expect(result).toContain("line one<br/>line two");
    const paramRow = result.split("\n").find(l => l.includes("`arg`"))!;
    expect(paramRow.trim().endsWith("|")).toBe(true);
  });

  it("should replace newlines with <br/> in enum value descriptions", () => {
    const en: DoxygenEnum = {
      name: "test_enum",
      id: "test",
      brief: "",
      description: "",
      values: [
        { name: "VAL_A", brief: "first\nsecond", description: "", additionalSections: {} },
      ],
      additionalSections: {},
    };
    const result = fumadocsPreset.enum(en, dummyCtx);
    expect(result).toContain("first<br/>second");
  });

  it("should replace newlines with <br/> in struct member descriptions", () => {
    const st: DoxygenStruct = {
      name: "test_struct",
      id: "test",
      brief: "",
      description: "",
      members: [
        { name: "field", type: { text: "int", refs: [] }, brief: "line one\nline two", description: "" },
      ],
      additionalSections: {},
    };
    const result = fumadocsPreset.struct(st, dummyCtx);
    expect(result).toContain("line one<br/>line two");
  });

  it("should still sanitize table cells in markdown preset", () => {
    const fn: DoxygenFunction = {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [
        { name: "arg", type: { text: "int", refs: [] }, description: "line one\nline two" },
      ],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test_func(int arg)",
      argsstring: "(int arg)",
    };
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("<br/>");
  });
});

describe("fumadocs meta.json generation", () => {
  it("should produce meta.json files for fumadocs output", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    const metaFiles = output.files.filter((f) => f.path.endsWith("meta.json"));
    expect(metaFiles.length).toBeGreaterThan(0);

    for (const metaFile of metaFiles) {
      const parsed = JSON.parse(metaFile.content);
      expect(parsed.pages).toBeDefined();
      expect(Array.isArray(parsed.pages)).toBe(true);
      for (const entry of parsed.pages) {
        expect(typeof entry).toBe("string");
        expect(entry.length).toBeGreaterThan(0);
      }
    }
  });

  it("should include title for non-root directories", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    const subDirMeta = output.files.find(
      (f) => f.path.endsWith("meta.json") && f.path.includes("/"),
    );
    if (subDirMeta) {
      const parsed = JSON.parse(subDirMeta.content);
      expect(parsed.title).toBeDefined();
      expect(typeof parsed.title).toBe("string");
    }
  });

  it("should sort pages alphabetically", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    const metaFiles = output.files.filter((f) => f.path.endsWith("meta.json"));
    for (const metaFile of metaFiles) {
      const parsed = JSON.parse(metaFile.content);
      const pages: string[] = parsed.pages;
      const sorted = [...pages].sort();
      expect(pages).toEqual(sorted);
    }
  });

  it("should NOT produce meta.json for markdown preset", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, markdownTemplates);

    const metaFiles = output.files.filter((f) => f.path.endsWith("meta.json"));
    expect(metaFiles.length).toBe(0);
  });
});

describe("macro documentation fields", () => {
  const dummyCtx = { index: {} } as any;

  function makeMacro(overrides: Partial<DoxygenMacro> = {}): DoxygenMacro {
    return {
      name: "TEST_MACRO",
      id: "test",
      params: ["x"],
      brief: "",
      description: "",
      additionalSections: {},
      ...overrides,
    };
  }

  it("should render param descriptions as table in markdown", () => {
    const mac = makeMacro({
      paramDescriptions: new Map([["x", "The input value"]]),
    });
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("**Parameters:**");
    expect(result).toContain("| Name | Description |");
    expect(result).toContain("| `x` | The input value |");
  });

  it("should render returnDescription in markdown", () => {
    const mac = makeMacro({ returnDescription: "The computed result" });
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("**Returns:** The computed result");
  });

  it("should render seeAlso in markdown", () => {
    const mac = makeMacro({ seeAlso: ["other_macro", "another_func"] });
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("**See also:** other_macro, another_func");
  });

  it("should render notes as blockquotes in markdown", () => {
    const mac = makeMacro({ notes: ["Important note here."] });
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("> **Note:** Important note here.");
  });

  it("should render warnings as blockquotes in markdown", () => {
    const mac = makeMacro({ warnings: ["Be careful!"] });
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("> **Warning:** Be careful!");
  });

  it("should render deprecated as blockquote in markdown", () => {
    const mac = makeMacro({ deprecated: "Use NEW_MACRO instead." });
    const result = markdownTemplates.macro(mac, dummyCtx);
    expect(result).toContain("> **Deprecated:** Use NEW_MACRO instead.");
  });

  it("should render notes as Callout info in fumadocs", () => {
    const mac = makeMacro({ notes: ["Important note here."] });
    const result = fumadocsPreset.macro(mac, dummyCtx);
    expect(result).toContain('<Callout type="info">');
    expect(result).toContain("Important note here.");
    expect(result).not.toContain("> **Note:**");
  });

  it("should render warnings as Callout warn in fumadocs", () => {
    const mac = makeMacro({ warnings: ["Be careful!"] });
    const result = fumadocsPreset.macro(mac, dummyCtx);
    expect(result).toContain('<Callout type="warn">');
    expect(result).toContain("Be careful!");
    expect(result).not.toContain("> **Warning:**");
  });

  it("should render deprecated as Callout error in fumadocs", () => {
    const mac = makeMacro({ deprecated: "Use NEW_MACRO instead." });
    const result = fumadocsPreset.macro(mac, dummyCtx);
    expect(result).toContain('<Callout type="error">');
    expect(result).toContain("**Deprecated:** Use NEW_MACRO instead.");
    expect(result).not.toContain("> **Deprecated:**");
  });
});

describe("inline anchor resolution", () => {
  it("should resolve {{dxanchor:id}} to <a> tags in markdown preset", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, markdownTemplates);

    for (const file of output.files) {
      expect(file.content).not.toContain("{{dxanchor:");
    }
  });

  it("should resolve {{dxanchor:id}} to {#id} in fumadocs preset", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    const mdxFiles = output.files.filter((f) => f.path.endsWith(".mdx"));
    for (const file of mdxFiles) {
      expect(file.content).not.toContain("{{dxanchor:");
    }
  });
});

describe("macro body rendering", () => {
  it("should not produce double backslash for multi-line macro initializers", () => {
    const mac: DoxygenMacro = {
      name: "MY_MACRO",
      id: "test",
      params: ["x", "y"],
      initializer: "do { \\\n    foo(x); \\\n    bar(y); \\\n} while(0)",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const parts: string[] = [];
    renderMacroDefinition(mac, parts);
    const output = parts.join("\n");
    // Should not contain double backslashes like "\ \"
    expect(output).not.toMatch(/\\\s*\\/);
    // Should contain proper single continuations
    expect(output).toContain(" \\");
  });

  it("should handle initializer lines without trailing backslash", () => {
    const mac: DoxygenMacro = {
      name: "SIMPLE",
      id: "test",
      initializer: "42",
      brief: "",
      description: "",
      additionalSections: {},
    };
    const parts: string[] = [];
    renderMacroDefinition(mac, parts);
    const output = parts.join("\n");
    expect(output).toContain("#define SIMPLE 42");
  });
});

describe("anonymous type cleaning", () => {
  it("should replace anonymous union names", () => {
    expect(cleanAnonymousTypes("union lv_font_glyph_dsc_t::@10526505117")).toBe("(anonymous union)");
  });

  it("should replace anonymous struct names", () => {
    expect(cleanAnonymousTypes("struct foo::@12345")).toBe("(anonymous struct)");
  });

  it("should not modify non-anonymous types", () => {
    expect(cleanAnonymousTypes("int")).toBe("int");
    expect(cleanAnonymousTypes("struct lv_color_t")).toBe("struct lv_color_t");
  });
});

describe("includes list rendering", () => {
  it("should render includes and includedby sections", () => {
    const includes = [
      { name: "stdio.h", local: false },
      { name: "my_header.h", local: true, path: "/api/my_header" },
    ];
    const includedby = [
      { name: "main.c", local: true, path: "/api/main" },
    ];
    const result = markdownTemplates.includesList!(includes, includedby);
    expect(result).toContain("## Includes");
    expect(result).toContain("<stdio.h>");
    expect(result).toContain('[\"my_header.h\"](/api/my_header)');
    expect(result).toContain("## Included by");
    expect(result).toContain("[main.c](/api/main)");
  });

  it("should return empty string when no includes", () => {
    const result = markdownTemplates.includesList!([], []);
    expect(result).toBe("");
  });
});

describe("ApiMember wrapper in fumadocs", () => {
  const dummyCtx = { index: {} } as any;

  it("should wrap functions in <ApiMember> tags", () => {
    const fn: DoxygenFunction = {
      name: "my_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [],
      brief: "A test function.",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void my_func()",
      argsstring: "()",
    };
    const rawContent = fumadocsPreset.function(fn, dummyCtx);
    const wrapped = fumadocsPreset.memberWrapper!("function", "my_func", rawContent);
    expect(wrapped).toContain('<ApiMember kind="function" name="my_func">');
    expect(wrapped).toContain("</ApiMember>");
    expect(wrapped).not.toContain("\n---\n");
  });

  it("should wrap enums in <ApiMember> tags", () => {
    const en: DoxygenEnum = {
      name: "my_enum",
      id: "test",
      brief: "",
      description: "",
      values: [{ name: "VAL_A", brief: "first", description: "", additionalSections: {} }],
      additionalSections: {},
    };
    const rawContent = fumadocsPreset.enum(en, dummyCtx);
    const wrapped = fumadocsPreset.memberWrapper!("enum", "my_enum", rawContent);
    expect(wrapped).toContain('<ApiMember kind="enum" name="my_enum">');
    expect(wrapped).toContain("</ApiMember>");
  });

  it("should strip trailing --- from wrapped content", () => {
    const content = "### test\n\nSome content.\n\n---\n";
    const wrapped = fumadocsPreset.memberWrapper!("function", "test", content);
    expect(wrapped).not.toMatch(/---/);
    expect(wrapped).toContain("Some content.");
  });
});

describe("no memberWrapper in markdown preset", () => {
  it("should not have memberWrapper defined", () => {
    expect(markdownTemplates.memberWrapper).toBeUndefined();
  });

  it("should not have memberGroupStart defined", () => {
    expect(markdownTemplates.memberGroupStart).toBeUndefined();
  });

  it("should not have memberGroupEnd defined", () => {
    expect(markdownTemplates.memberGroupEnd).toBeUndefined();
  });
});

describe("frontmatter symbol index", () => {
  it("should include api: block in fumadocs file output", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, fumadocsPreset);

    const mdxFiles = output.files.filter((f) => f.path.endsWith(".mdx"));
    // Find a file with functions
    const fileWithFns = mdxFiles.find((f) => f.content.includes("## Functions"));
    expect(fileWithFns).toBeDefined();
    expect(fileWithFns!.content).toContain("api:");
    expect(fileWithFns!.content).toContain("functions:");
  });

  it("should not include api: block in markdown file output", async () => {
    const parseResult = await parse(FIXTURES_DIR);
    const output = render(parseResult, markdownTemplates);

    for (const file of output.files) {
      expect(file.content).not.toContain("api:");
    }
  });
});

describe("enum 3-column table", () => {
  const dummyCtx = { index: {} } as any;

  it("should render Name, Value, Description columns in markdown", () => {
    const en: DoxygenEnum = {
      name: "test_enum",
      id: "test",
      brief: "",
      description: "",
      values: [
        { name: "VAL_A", initializer: "= 0x01", brief: "First value", description: "", additionalSections: {} },
        { name: "VAL_B", brief: "Second value", description: "", additionalSections: {} },
      ],
      additionalSections: {},
    };
    const result = markdownTemplates.enum(en, dummyCtx);
    expect(result).toContain("| Name | Value | Description |");
    expect(result).toContain("| `VAL_A` | `0x01` | First value |");
    expect(result).toContain("| `VAL_B` |  | Second value |");
  });

  it("should strip = prefix from initializer", () => {
    const en: DoxygenEnum = {
      name: "test_enum",
      id: "test",
      brief: "",
      description: "",
      values: [
        { name: "VAL", initializer: "= 42", brief: "", description: "", additionalSections: {} },
      ],
      additionalSections: {},
    };
    const result = fumadocsPreset.enum(en, dummyCtx);
    expect(result).toContain("| `VAL` | `42` |");
    expect(result).not.toContain("= 42");
  });

  it("should render 3 columns in fumadocs", () => {
    const en: DoxygenEnum = {
      name: "test_enum",
      id: "test",
      brief: "",
      description: "",
      values: [
        { name: "X", initializer: "= 0", brief: "desc", description: "", additionalSections: {} },
      ],
      additionalSections: {},
    };
    const result = fumadocsPreset.enum(en, dummyCtx);
    expect(result).toContain("| Name | Value | Description |");
  });
});

describe("bold direction prefix", () => {
  const dummyCtx = { index: {} } as any;

  function makeFnWithDir(direction: string): DoxygenFunction {
    return {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [
        { name: "arg", type: { text: "int", refs: [] }, direction, description: "some arg" },
      ],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test_func(int arg)",
      argsstring: "(int arg)",
    };
  }

  it("should bold [in] prefix in markdown", () => {
    const fn = makeFnWithDir("in");
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("**[in]** `arg`");
  });

  it("should bold [out] prefix in fumadocs", () => {
    const fn = makeFnWithDir("out");
    const result = fumadocsPreset.function(fn, dummyCtx);
    expect(result).toContain("**[out]** `arg`");
  });

  it("should bold [in,out] prefix in markdown", () => {
    const fn = makeFnWithDir("in,out");
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("**[in,out]** `arg`");
  });

  it("should not add prefix when direction is absent", () => {
    const fn: DoxygenFunction = {
      name: "test_func",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [
        { name: "arg", type: { text: "int", refs: [] }, description: "some arg" },
      ],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: "void test_func(int arg)",
      argsstring: "(int arg)",
    };
    const result = markdownTemplates.function(fn, dummyCtx);
    expect(result).toContain("| `arg` |");
    expect(result).not.toContain("**[");
  });
});

describe("collapsible member groups", () => {
  it("should have memberGroupStart and memberGroupEnd in fumadocs", () => {
    expect(fumadocsPreset.memberGroupStart).toBeDefined();
    expect(fumadocsPreset.memberGroupEnd).toBeDefined();
  });

  it("should render <Collapsible> tags from memberGroupStart/End", () => {
    const group = { header: "Widget functions", description: "" };
    const start = fumadocsPreset.memberGroupStart!(group);
    const end = fumadocsPreset.memberGroupEnd!();
    expect(start).toContain('<Collapsible title="Widget functions" defaultOpen>');
    expect(end).toBe("</Collapsible>");
  });

  it("should escape quotes in group header", () => {
    const group = { header: 'Functions for "special" cases', description: "" };
    const start = fumadocsPreset.memberGroupStart!(group);
    expect(start).toContain('title="Functions for \\"special\\" cases"');
  });
});

describe("void return suppression", () => {
  it("should not render Returns section for void functions with return doc", () => {
    const fn: DoxygenFunction = {
      name: "test_fn",
      id: "test",
      returnType: { text: "void", refs: [] },
      params: [],
      brief: "",
      description: "",
      returnDescription: "nothing useful",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
    };
    const ctx = {
      file: {
        kind: "file" as const,
        name: "test.h",
        compoundId: "test",
        path: "test.h",
        brief: "",
        description: "",
        functions: [],
        enums: [],
        structs: [],
        typedefs: [],
        macros: [],
        variables: [],
        includes: [],
        includedby: [],
        memberGroups: [],
      },
      index: {},
    };
    const output = markdownTemplates.function.call(markdownTemplates, fn, ctx);
    expect(output).not.toContain("**Returns:**");
  });
});

describe("classifyFunction", () => {
  it("should classify _set_ functions as Setters", () => {
    expect(classifyFunction("lv_arc_set_start_angle")).toBe("Setters");
    expect(classifyFunction("lv_obj_set_style_width")).toBe("Setters");
  });

  it("should classify functions ending in _set as Setters", () => {
    expect(classifyFunction("lv_obj_flag_set")).toBe("Setters");
  });

  it("should classify _get_ functions as Getters", () => {
    expect(classifyFunction("lv_arc_get_angle_start")).toBe("Getters");
    expect(classifyFunction("lv_obj_get_style_width")).toBe("Getters");
  });

  it("should classify functions ending in _get as Getters", () => {
    expect(classifyFunction("lv_obj_flag_get")).toBe("Getters");
  });

  it("should classify other functions as Other", () => {
    expect(classifyFunction("lv_obj_create")).toBe("Other");
    expect(classifyFunction("lv_arc_rotate")).toBe("Other");
    expect(classifyFunction("reset")).toBe("Other");
  });
});

describe("auto-group functions", () => {
  function makeFn(name: string): DoxygenFunction {
    return {
      name,
      id: name,
      returnType: { text: "void", refs: [] },
      params: [],
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: `void ${name}()`,
      argsstring: "()",
    };
  }

  function makeParseResult(functions: DoxygenFunction[]) {
    return {
      files: [{
        kind: "file" as const,
        name: "test.h",
        compoundId: "test_8h",
        path: "test.h",
        brief: "",
        description: "",
        functions,
        enums: [],
        structs: [],
        typedefs: [],
        macros: [],
        variables: [],
        includes: [],
        includedby: [],
        memberGroups: [],
      }],
      compounds: [{
        kind: "file" as const,
        name: "test.h",
        compoundId: "test_8h",
        path: "test.h",
        brief: "",
        description: "",
        functions,
        enums: [],
        structs: [],
        typedefs: [],
        macros: [],
        variables: [],
        includes: [],
        includedby: [],
        memberGroups: [],
      }],
      index: {},
      warnings: [],
    };
  }

  it("should render <Tabs> with Fumadocs when auto-group is enabled", () => {
    const functions = [
      makeFn("lv_arc_set_start_angle"),
      makeFn("lv_arc_get_angle_start"),
      makeFn("lv_arc_create"),
    ];
    const result = render(makeParseResult(functions), fumadocsPreset, { autoGroupFunctions: true });
    const file = result.files.find(f => f.path.includes("test"));
    expect(file).toBeDefined();
    expect(file!.content).toContain('<ApiTabs items=');
    expect(file!.content).toContain('<ApiTab value="Setters (1)">');
    expect(file!.content).toContain('<ApiTab value="Getters (1)">');
    expect(file!.content).toContain('<ApiTab value="Other (1)">');
    expect(file!.content).toContain("lv_arc_set_start_angle");
    expect(file!.content).toContain("lv_arc_get_angle_start");
    expect(file!.content).toContain("lv_arc_create");
  });

  it("should render ### subheadings with markdown when auto-group is enabled", () => {
    const functions = [
      makeFn("lv_arc_set_start_angle"),
      makeFn("lv_arc_get_angle_start"),
      makeFn("lv_arc_create"),
    ];
    const result = render(makeParseResult(functions), markdownTemplates, { autoGroupFunctions: true });
    const file = result.files.find(f => f.path.includes("test"));
    expect(file).toBeDefined();
    expect(file!.content).toContain("### Setters (1)");
    expect(file!.content).toContain("### Getters (1)");
    expect(file!.content).toContain("### Other (1)");
  });

  it("should skip grouping when only one category exists", () => {
    const functions = [
      makeFn("lv_arc_get_angle"),
      makeFn("lv_arc_get_value"),
    ];
    const result = render(makeParseResult(functions), fumadocsPreset, { autoGroupFunctions: true });
    const file = result.files.find(f => f.path.includes("test"));
    expect(file).toBeDefined();
    expect(file!.content).not.toContain("<ApiTabs");
    expect(file!.content).not.toContain("<ApiTab");
    expect(file!.content).toContain("lv_arc_get_angle");
    expect(file!.content).toContain("lv_arc_get_value");
  });

  it("should render flat (no tabs) without auto-group flag", () => {
    const functions = [
      makeFn("lv_arc_set_start_angle"),
      makeFn("lv_arc_get_angle_start"),
      makeFn("lv_arc_create"),
    ];
    const result = render(makeParseResult(functions), fumadocsPreset);
    const file = result.files.find(f => f.path.includes("test"));
    expect(file).toBeDefined();
    expect(file!.content).not.toContain("<ApiTabs");
    expect(file!.content).not.toContain("<ApiTab");
  });

  it("should omit empty groups from tabs", () => {
    const functions = [
      makeFn("lv_arc_set_start_angle"),
      makeFn("lv_arc_create"),
    ];
    const result = render(makeParseResult(functions), fumadocsPreset, { autoGroupFunctions: true });
    const file = result.files.find(f => f.path.includes("test"));
    expect(file).toBeDefined();
    expect(file!.content).toContain('<ApiTab value="Setters (1)">');
    expect(file!.content).toContain('<ApiTab value="Other (1)">');
    expect(file!.content).not.toContain('<ApiTab value="Getters');
  });
});

describe("cross-file intelligence features", () => {
  function makeFn(name: string, params: { name: string; type: { text: string; refs: { name: string; refid: string }[] } }[] = []): DoxygenFunction {
    return {
      name,
      id: name,
      returnType: { text: "void", refs: [] },
      params: params.map(p => ({ ...p, description: "" })),
      brief: "",
      description: "",
      returnDescription: "",
      retvalDescriptions: new Map(),
      exceptions: new Map(),
      notes: [],
      warnings: [],
      seeAlso: [],
      isStatic: false,
      additionalSections: {},
      definition: `void ${name}()`,
      argsstring: "()",
    };
  }

  function makeTestParseResult(overrides: {
    files?: any[];
    compounds?: any[];
  } = {}) {
    const compounds = overrides.compounds || overrides.files || [];
    return {
      files: overrides.files || compounds,
      compounds,
      index: {},
      warnings: [],
    };
  }

  describe("ApiSummary rendering", () => {
    it("should render <ApiSummary> in fumadocs output", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "test.h",
              compoundId: "test_8h",
              path: "test.h",
              brief: "",
              description: "",
              functions: [makeFn("fn_a"), makeFn("fn_b")],
              enums: [{ name: "my_enum", id: "e1", brief: "", description: "", values: [], additionalSections: {} }],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const file = result.files.find(f => f.path.includes("test"));
      expect(file).toBeDefined();
      expect(file!.content).toContain("<ApiSummary");
      expect(file!.content).toContain("functions={2}");
      expect(file!.content).toContain("enums={1}");
    });

    it("should render blockquote API Surface in markdown output", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "test.h",
              compoundId: "test_8h",
              path: "test.h",
              brief: "",
              description: "",
              functions: [makeFn("fn_a")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        markdownTemplates,
      );

      const file = result.files.find(f => f.path.includes("test"));
      expect(file).toBeDefined();
      expect(file!.content).toContain("> **API Surface:** 1 functions");
    });
  });

  describe("RelatedHeaders rendering", () => {
    it("should render <RelatedHeaders> for paired public/private files in fumadocs", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "lv_obj.h",
              compoundId: "lv_obj_8h",
              path: "core/lv_obj.h",
              brief: "",
              description: "",
              functions: [makeFn("lv_obj_create")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
            {
              kind: "file",
              name: "lv_obj_private.h",
              compoundId: "lv_obj_private_8h",
              path: "core/lv_obj_private.h",
              brief: "",
              description: "",
              functions: [],
              enums: [],
              structs: [{ name: "lv_obj_t", id: "s1", brief: "", description: "", members: [], functions: [], additionalSections: {} }],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const publicFile = result.files.find(f => f.path.includes("lv_obj_h"));
      expect(publicFile).toBeDefined();
      expect(publicFile!.content).toContain("<RelatedHeaders");
      expect(publicFile!.content).toContain("lv_obj_private");

      const privateFile = result.files.find(f => f.path.includes("lv_obj_private"));
      expect(privateFile).toBeDefined();
      expect(privateFile!.content).toContain("<RelatedHeaders");
    });

    it("should render blockquote See also for paired files in markdown", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "foo.h",
              compoundId: "foo_8h",
              path: "foo.h",
              brief: "",
              description: "",
              functions: [makeFn("foo_init")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
            {
              kind: "file",
              name: "foo_private.h",
              compoundId: "foo_private_8h",
              path: "foo_private.h",
              brief: "",
              description: "",
              functions: [],
              enums: [],
              structs: [{ name: "foo_t", id: "s1", brief: "", description: "", members: [], functions: [], additionalSections: {} }],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        markdownTemplates,
      );

      const publicFile = result.files.find(f => f.path === "foo_h.md");
      expect(publicFile).toBeDefined();
      expect(publicFile!.content).toContain("> **See also:**");
      expect(publicFile!.content).toContain("foo_private");
    });
  });

  describe("SourceLink rendering", () => {
    it("should render source info as ApiMember props in fumadocs when sourceUrlBase is set", () => {
      const fn = makeFn("my_func");
      fn.location = { file: "src/my_file.h", line: 42 };

      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "test.h",
              compoundId: "test_8h",
              path: "test.h",
              brief: "",
              description: "",
              functions: [fn],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
        { sourceUrlBase: "https://github.com/example/repo/blob/main" },
      );

      const file = result.files.find(f => f.path.includes("test"));
      expect(file).toBeDefined();
      expect(file!.content).toContain('file="src/my_file.h"');
      expect(file!.content).toContain("line={42}");
      expect(file!.content).toContain('url="https://github.com/example/repo/blob/main/src/my_file.h#L42"');
      expect(file!.content).not.toContain("<SourceLink");
    });

    it("should not render source props on ApiMember when sourceUrlBase is not set", () => {
      const fn = makeFn("my_func");
      fn.location = { file: "src/my_file.h", line: 42 };

      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "test.h",
              compoundId: "test_8h",
              path: "test.h",
              brief: "",
              description: "",
              functions: [fn],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const file = result.files.find(f => f.path.includes("test"));
      expect(file).toBeDefined();
      expect(file!.content).not.toContain('file=');
      expect(file!.content).not.toContain('url=');
    });
  });

  describe("TypeUsedBy rendering", () => {
    it("should render <TypeUsedBy> after enum in fumadocs", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "test.h",
              compoundId: "test_8h",
              path: "test.h",
              brief: "",
              description: "",
              functions: [
                makeFn("set_mode", [
                  { name: "mode", type: { text: "mode_t", refs: [{ name: "mode_t", refid: "r1" }] } },
                ]),
              ],
              enums: [{ name: "mode_t", id: "e1", brief: "", description: "", values: [], additionalSections: {} }],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const file = result.files.find(f => f.path.includes("test"));
      expect(file).toBeDefined();
      expect(file!.content).toContain("<TypeUsedBy");
      expect(file!.content).toContain('name="mode_t"');
      expect(file!.content).toContain("set_mode");
    });
  });

  describe("directoryIndex generation", () => {
    it("should generate index.mdx in fumadocs", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "lv_arc.h",
              compoundId: "lv_arc_8h",
              path: "widgets/lv_arc.h",
              brief: "Arc widget",
              description: "",
              functions: [makeFn("lv_arc_create")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const indexFile = result.files.find(f => f.path === "widgets/index.mdx");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain("<ModuleOverview>");
      expect(indexFile!.content).toContain("lv_arc.h");
      expect(indexFile!.content).toContain("Arc widget");
    });

    it("should generate index.md in markdown", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "lv_arc.h",
              compoundId: "lv_arc_8h",
              path: "widgets/lv_arc.h",
              brief: "Arc widget",
              description: "",
              functions: [makeFn("lv_arc_create")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        markdownTemplates,
      );

      const indexFile = result.files.find(f => f.path === "widgets/index.md");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain("# Widgets");
      expect(indexFile!.content).toContain("lv_arc.h");
    });

    it("should render subdirectories as <IndexCards> in fumadocs", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "lv_arc.h",
              compoundId: "lv_arc_8h",
              path: "widgets/arc/lv_arc.h",
              brief: "Arc widget",
              description: "",
              functions: [makeFn("lv_arc_create")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
            {
              kind: "file",
              name: "lv_btnmatrix.h",
              compoundId: "lv_btnmatrix_8h",
              path: "widgets/button_matrix/lv_btnmatrix.h",
              brief: "Button matrix widget",
              description: "",
              functions: [makeFn("lv_btnmatrix_create")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const indexFile = result.files.find(f => f.path === "widgets/index.mdx");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain("<IndexCards");
      expect(indexFile!.content).toContain('title: "Arc"');
      expect(indexFile!.content).toContain('title: "Button Matrix"');
      expect(indexFile!.content).toContain('href: "./arc"');
      expect(indexFile!.content).toContain('href: "./button_matrix"');
      expect(indexFile!.content).not.toContain("- [");
    });

    it("should NOT include 'index' in meta.json pages array", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "lv_arc.h",
              compoundId: "lv_arc_8h",
              path: "widgets/lv_arc.h",
              brief: "",
              description: "",
              functions: [makeFn("lv_arc_create")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const indexFile = result.files.find(f => f.path === "widgets/index.mdx");
      expect(indexFile).toBeDefined();

      const metaFile = result.files.find(f => f.path === "widgets/meta.json");
      expect(metaFile).toBeDefined();
      const meta = JSON.parse(metaFile!.content);
      expect(meta.pages).not.toContain("index");
    });
  });

  describe("MDX text escaping", () => {
    it("should escape bare curly braces in descriptions", () => {
      const fn: DoxygenFunction = {
        name: "test_fn",
        id: "test",
        returnType: { text: "void", refs: [] },
        params: [],
        brief: 'Get default maps: {"Btn1", "Btn2", ""}, else map not set.',
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: [],
        warnings: [],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_fn()",
        argsstring: "()",
      };
      const dummyCtx = { index: {} } as any;
      const result = fumadocsPreset.function(fn, dummyCtx);
      expect(result).toContain('\\{"Btn1"');
      expect(result).toContain('\\}');
      expect(result).not.toMatch(/(?<!\\)\{"/);
    });

    it("should escape bare < that is not an HTML tag", () => {
      const fn: DoxygenFunction = {
        name: "test_fn",
        id: "test",
        returnType: { text: "void", refs: [] },
        params: [],
        brief: "Includes <stdint.h> and checks x < 10.",
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: [],
        warnings: [],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_fn()",
        argsstring: "()",
      };
      const dummyCtx = { index: {} } as any;
      const result = fumadocsPreset.function(fn, dummyCtx);
      expect(result).toContain("\\<stdint.h\\>");
      expect(result).toContain("x \\< 10");
    });

    it("should not escape characters inside inline code", () => {
      const fn: DoxygenFunction = {
        name: "test_fn",
        id: "test",
        returnType: { text: "void", refs: [] },
        params: [],
        brief: "Returns `{value}` from buffer.",
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: [],
        warnings: [],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_fn()",
        argsstring: "()",
      };
      const dummyCtx = { index: {} } as any;
      const result = fumadocsPreset.function(fn, dummyCtx);
      expect(result).toContain("`{value}`");
      expect(result).not.toContain("`\\{value\\}`");
    });

    it("should escape curly braces in param descriptions", () => {
      const fn: DoxygenFunction = {
        name: "test_fn",
        id: "test",
        returnType: { text: "void", refs: [] },
        params: [
          { name: "map", type: { text: "const char **", refs: [] }, description: 'e.g. {"a", "b", ""}' },
        ],
        brief: "",
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: [],
        warnings: [],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_fn(const char **map)",
        argsstring: "(const char **map)",
      };
      const dummyCtx = { index: {} } as any;
      const result = fumadocsPreset.function(fn, dummyCtx);
      expect(result).toContain('\\{"a"');
    });

    it("should escape curly braces in notes and warnings", () => {
      const fn: DoxygenFunction = {
        name: "test_fn",
        id: "test",
        returnType: { text: "void", refs: [] },
        params: [],
        brief: "",
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: ["Use format {key: value}"],
        warnings: ["Do not pass {null}"],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_fn()",
        argsstring: "()",
      };
      const dummyCtx = { index: {} } as any;
      const result = fumadocsPreset.function(fn, dummyCtx);
      expect(result).toContain("\\{key: value\\}");
      expect(result).toContain("\\{null\\}");
    });

    it("should not escape in markdown preset (only MDX needs it)", () => {
      const fn: DoxygenFunction = {
        name: "test_fn",
        id: "test",
        returnType: { text: "void", refs: [] },
        params: [],
        brief: 'Get maps: {"Btn1", "Btn2"}',
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: [],
        warnings: [],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_fn()",
        argsstring: "()",
      };
      const dummyCtx = { index: {} } as any;
      const result = markdownTemplates.function.call(markdownTemplates, fn, dummyCtx);
      expect(result).toContain('{"Btn1"');
      expect(result).not.toContain("\\{");
    });
  });

  describe("transitive includes", () => {
    it("should show transitive includes in collapsible section in fumadocs", () => {
      const result = render(
        makeTestParseResult({
          compounds: [
            {
              kind: "file",
              name: "a.h",
              compoundId: "a_8h",
              path: "a.h",
              brief: "",
              description: "",
              functions: [makeFn("fn_a")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [{ name: "b.h", local: true }],
              includedby: [],
              memberGroups: [],
            },
            {
              kind: "file",
              name: "b.h",
              compoundId: "b_8h",
              path: "b.h",
              brief: "",
              description: "",
              functions: [makeFn("fn_b")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [{ name: "c.h", local: true }],
              includedby: [],
              memberGroups: [],
            },
            {
              kind: "file",
              name: "c.h",
              compoundId: "c_8h",
              path: "c.h",
              brief: "",
              description: "",
              functions: [makeFn("fn_c")],
              enums: [],
              structs: [],
              typedefs: [],
              macros: [],
              variables: [],
              includes: [],
              includedby: [],
              memberGroups: [],
            },
          ],
        }),
        fumadocsPreset,
      );

      const fileA = result.files.find(f => f.path === "a_h.mdx");
      expect(fileA).toBeDefined();
      expect(fileA!.content).toContain("transitiveIncludes=");
      expect(fileA!.content).toContain("c.h");
    });
  });
});

describe("escapeMdxText", () => {
  it("should return empty/falsy values unchanged", () => {
    expect(escapeMdxText("")).toBe("");
    expect(escapeMdxText(undefined as any)).toBe(undefined);
  });

  it("should return text without special chars unchanged", () => {
    expect(escapeMdxText("Hello world")).toBe("Hello world");
  });

  it("should escape bare curly braces", () => {
    expect(escapeMdxText('maps: {"a", "b"}')).toBe('maps: \\{"a", "b"\\}');
  });

  it("should preserve content inside inline code", () => {
    expect(escapeMdxText("use `{value}` here")).toBe("use `{value}` here");
  });

  it("should preserve content inside code fences", () => {
    const input = "before\n```c\nstruct { int x; };\n```\nafter {bad}";
    const result = escapeMdxText(input);
    expect(result).toContain("```c\nstruct { int x; };\n```");
    expect(result).toContain("after \\{bad\\}");
  });

  it("should preserve {{dxanchor:...}} placeholders", () => {
    expect(escapeMdxText("text {{dxanchor:my_id}} more")).toBe("text {{dxanchor:my_id}} more");
  });

  it("should escape bare < that is not an HTML tag", () => {
    expect(escapeMdxText("x < 10")).toBe("x \\< 10");
    expect(escapeMdxText("<stdint.h>")).toBe("\\<stdint.h\\>");
    expect(escapeMdxText("a << b")).toBe("a \\<\\< b");
  });

  it("should escape all angle brackets in description text", () => {
    expect(escapeMdxText("line<br/>break")).toBe("line\\<br/\\>break");
    expect(escapeMdxText("<CONST>")).toBe("\\<CONST\\>");
    expect(escapeMdxText("LV_<CONST>")).toBe("LV_\\<CONST\\>");
  });

  it("should escape content after an unclosed inline-code backtick", () => {
    // Regression: an unmatched backtick used to swallow the rest of the string
    // verbatim, letting <, {, | leak through into MDX output.
    expect(escapeMdxText("default `!?%/\\-=()[]{}<>@#&$")).toBe(
      "default `!?%/\\-=()[]\\{\\}\\<\\>@#&$"
    );
  });

  it("should handle mixed content", () => {
    const input = 'Get maps: {"Btn1", "Btn2"}, see `<stdio.h>` and <br/> tag.';
    const result = escapeMdxText(input);
    expect(result).toContain('\\{"Btn1"');
    expect(result).toContain("\\}");
    expect(result).toContain("`<stdio.h>`");
    expect(result).toContain("\\<br/\\>");
  });
});

describe("table cell sanitization", () => {
  describe("escapePipesOutsideCode", () => {
    it("escapes unescaped pipes in plain text", () => {
      expect(escapePipesOutsideCode("A | B")).toBe("A \\| B");
    });

    it("leaves already-escaped pipes alone", () => {
      expect(escapePipesOutsideCode("A \\| B")).toBe("A \\| B");
    });

    it("leaves pipes inside backtick code spans alone", () => {
      expect(escapePipesOutsideCode("see `a | b` here"))
        .toBe("see `a | b` here");
    });

    it("escapes pipes outside code spans but preserves pipes inside", () => {
      expect(escapePipesOutsideCode("A | `b | c` | D"))
        .toBe("A \\| `b | c` \\| D");
    });

    it("is a no-op for text without pipes", () => {
      expect(escapePipesOutsideCode("hello world")).toBe("hello world");
    });

    it("leaves pipes inside {{...}} placeholders alone", () => {
      expect(escapePipesOutsideCode("see {{dxlink:LV_A|path/to/thing}} now"))
        .toBe("see {{dxlink:LV_A|path/to/thing}} now");
    });

    it("escapes pipes outside placeholders and leaves pipes inside", () => {
      expect(escapePipesOutsideCode("A | {{dxlink:X|Y}} | B"))
        .toBe("A \\| {{dxlink:X|Y}} \\| B");
    });
  });

  describe("sanitizeForTableCell (markdown preset)", () => {
    it("escapes pipes", () => {
      expect(sanitizeForTableCell("LV_A | LV_B")).toBe("LV_A \\| LV_B");
    });

    it("converts newlines to <br/>", () => {
      expect(sanitizeForTableCell("line 1\nline 2")).toBe("line 1<br/>line 2");
    });

    it("handles both pipes and newlines together", () => {
      expect(sanitizeForTableCell("LV_A | LV_B\nmore"))
        .toBe("LV_A \\| LV_B<br/>more");
    });
  });

  describe("sanitizeForMdxTableCell (fumadocs preset)", () => {
    it("escapes pipes", () => {
      expect(sanitizeForMdxTableCell("LV_A | LV_B")).toBe("LV_A \\| LV_B");
    });

    it("converts newlines to <br/>", () => {
      expect(sanitizeForMdxTableCell("line 1\nline 2"))
        .toBe("line 1<br/>line 2");
    });

    it("MDX-escapes bare <, >, {, } in text portions", () => {
      const result = sanitizeForMdxTableCell("see <T> and {x}");
      expect(result).toContain("\\<T\\>");
      expect(result).toContain("\\{x\\}");
    });

    it("preserves pipes inside code spans", () => {
      expect(sanitizeForMdxTableCell("ex: `a | b` end"))
        .toBe("ex: `a | b` end");
    });

    it("applies all transforms together", () => {
      const result = sanitizeForMdxTableCell("LV_A | LV_B\nsee <T>");
      expect(result).toBe("LV_A \\| LV_B<br/>see \\<T\\>");
    });
  });

  describe("fumadocs preset integration — no broken table rows", () => {
    function makeFn(overrides: Partial<DoxygenFunction> = {}): DoxygenFunction {
      return {
        name: "test_func",
        id: "tf",
        returnType: { text: "void", refs: [] },
        params: [],
        brief: "",
        description: "",
        returnDescription: "",
        retvalDescriptions: new Map(),
        exceptions: new Map(),
        notes: [],
        warnings: [],
        seeAlso: [],
        isStatic: false,
        additionalSections: {},
        definition: "void test_func()",
        argsstring: "()",
        ...overrides,
      };
    }

    function makeFileCompound(functions: DoxygenFunction[]) {
      return {
        kind: "file" as const,
        name: "test.h",
        compoundId: "test_8h",
        path: "test.h",
        brief: "",
        description: "",
        functions,
        enums: [],
        structs: [],
        typedefs: [],
        macros: [],
        variables: [],
        includes: [],
        includedby: [],
        memberGroups: [],
      };
    }

    it("escapes unescaped pipes in param descriptions", () => {
      const fn = makeFn({
        params: [{
          name: "flags",
          type: { text: "int", refs: [] },
          description: "e.g. LV_STATE_PRESSED | LV_PART_KNOB",
        }],
      });
      const result = render(
        { files: [makeFileCompound([fn])], compounds: [makeFileCompound([fn])], index: {}, warnings: [] } as any,
        fumadocsPreset,
      );
      const file = result.files.find(f => f.path.endsWith(".mdx"))!;
      expect(file.content).toContain("LV_STATE_PRESSED \\| LV_PART_KNOB");
      // And the row must still end with a closing pipe
      const paramRow = file.content.split("\n").find(l => l.includes("flags"));
      expect(paramRow).toBeDefined();
      expect(paramRow!.trim().endsWith("|")).toBe(true);
    });

    it("converts multi-line param descriptions to <br/>", () => {
      const fn = makeFn({
        params: [{
          name: "cb",
          type: { text: "void*", refs: [] },
          description: "Cleanup callback that receives ext_data when:\nfirst case\nsecond case",
        }],
      });
      const result = render(
        { files: [makeFileCompound([fn])], compounds: [makeFileCompound([fn])], index: {}, warnings: [] } as any,
        fumadocsPreset,
      );
      const file = result.files.find(f => f.path.endsWith(".mdx"))!;
      const paramRow = file.content.split("\n").find(l => l.includes("`cb`"))!;
      expect(paramRow).toContain("<br/>");
      expect(paramRow).not.toContain("\n");
      expect(paramRow.trim().endsWith("|")).toBe(true);
    });

    it("still MDX-escapes < { } inside param descriptions (regression)", () => {
      const fn = makeFn({
        params: [{
          name: "x",
          type: { text: "int", refs: [] },
          description: "value like {a} or <T>",
        }],
      });
      const result = render(
        { files: [makeFileCompound([fn])], compounds: [makeFileCompound([fn])], index: {}, warnings: [] } as any,
        fumadocsPreset,
      );
      const file = result.files.find(f => f.path.endsWith(".mdx"))!;
      expect(file.content).toContain("\\{a\\}");
      expect(file.content).toContain("\\<T\\>");
    });
  });
});
