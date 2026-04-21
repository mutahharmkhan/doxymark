import { describe, it, expect } from "vitest";
import {
  buildTypeUsage,
  buildPrivateHeaderPairs,
  buildCallbackTypedefs,
  buildTypeHubCounts,
  buildTransitiveIncludes,
  analyze,
} from "../../src/analyzer/cross-references.js";
import type { DoxygenFile, DoxygenCompound, ParseResult } from "../../src/parser/types.js";

/** Helper to create a minimal file compound for testing */
function makeFile(overrides: Partial<DoxygenFile> & { name: string; path: string }): DoxygenFile {
  return {
    kind: "file",
    compoundId: overrides.name,
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
    ...overrides,
  };
}

describe("buildTypeUsage", () => {
  it("should build reverse index from function params to types", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "lv_arc.h",
        path: "widgets/lv_arc.h",
        functions: [
          {
            name: "lv_arc_set_mode",
            id: "fn1",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "obj", type: { text: "lv_obj_t *", refs: [{ name: "lv_obj_t", refid: "r1" }] }, description: "" },
              { name: "mode", type: { text: "lv_arc_mode_t", refs: [{ name: "lv_arc_mode_t", refid: "r2" }] }, description: "" },
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
          },
        ],
      }),
    ];

    const result = buildTypeUsage(compounds);

    expect(result.has("lv_arc_mode_t")).toBe(true);
    const entries = result.get("lv_arc_mode_t")!;
    expect(entries).toHaveLength(1);
    expect(entries[0].functionName).toBe("lv_arc_set_mode");
    expect(entries[0].paramIndex).toBe(1);
    expect(entries[0].paramName).toBe("mode");

    expect(result.has("lv_obj_t")).toBe(true);
    expect(result.get("lv_obj_t")!).toHaveLength(1);
  });

  it("should aggregate multiple functions referencing the same type", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "a.h",
        path: "a.h",
        functions: [
          {
            name: "fn_a",
            id: "a1",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "x", type: { text: "my_type_t", refs: [{ name: "my_type_t", refid: "r1" }] }, description: "" },
            ],
            brief: "", description: "", returnDescription: "",
            retvalDescriptions: new Map(), exceptions: new Map(),
            notes: [], warnings: [], seeAlso: [], isStatic: false,
            additionalSections: {},
          },
          {
            name: "fn_b",
            id: "a2",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "y", type: { text: "my_type_t *", refs: [{ name: "my_type_t", refid: "r1" }] }, description: "" },
            ],
            brief: "", description: "", returnDescription: "",
            retvalDescriptions: new Map(), exceptions: new Map(),
            notes: [], warnings: [], seeAlso: [], isStatic: false,
            additionalSections: {},
          },
        ],
      }),
    ];

    const result = buildTypeUsage(compounds);
    expect(result.get("my_type_t")).toHaveLength(2);
  });
});

describe("buildPrivateHeaderPairs", () => {
  it("should pair foo.h with foo_private.h", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({ name: "lv_obj.h", path: "core/lv_obj.h" }),
      makeFile({ name: "lv_obj_private.h", path: "core/lv_obj_private.h" }),
    ];

    const result = buildPrivateHeaderPairs(compounds);

    expect(result.has("lv_obj.h")).toBe(true);
    expect(result.get("lv_obj.h")).toBe("core/lv_obj_private_h");
    expect(result.has("lv_obj_private.h")).toBe(true);
    expect(result.get("lv_obj_private.h")).toBe("core/lv_obj_h");
  });

  it("should not pair when counterpart does not exist", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({ name: "lv_obj.h", path: "core/lv_obj.h" }),
    ];

    const result = buildPrivateHeaderPairs(compounds);
    expect(result.size).toBe(0);
  });
});

describe("buildCallbackTypedefs", () => {
  it("should detect function pointer typedefs", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "lv_event.h",
        path: "misc/lv_event.h",
        typedefs: [
          {
            name: "lv_event_cb_t",
            id: "td1",
            type: { text: "void (*)(lv_event_t *)", refs: [] },
            definition: "typedef void (*lv_event_cb_t)(lv_event_t *e)",
            brief: "",
            description: "",
            additionalSections: {},
          },
          {
            name: "lv_color_t",
            id: "td2",
            type: { text: "uint32_t", refs: [] },
            brief: "",
            description: "",
            additionalSections: {},
          },
        ],
      }),
    ];

    const result = buildCallbackTypedefs(compounds);

    expect(result.has("lv_event_cb_t")).toBe(true);
    expect(result.get("lv_event_cb_t")).toContain("(*lv_event_cb_t)");
    expect(result.has("lv_color_t")).toBe(false);
  });
});

describe("buildTypeHubCounts", () => {
  it("should count distinct files referencing each type", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "a.h",
        path: "a.h",
        functions: [
          {
            name: "fn_a",
            id: "a1",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "x", type: { text: "common_t", refs: [{ name: "common_t", refid: "r1" }] }, description: "" },
            ],
            brief: "", description: "", returnDescription: "",
            retvalDescriptions: new Map(), exceptions: new Map(),
            notes: [], warnings: [], seeAlso: [], isStatic: false,
            additionalSections: {},
          },
        ],
      }),
      makeFile({
        name: "b.h",
        path: "b.h",
        functions: [
          {
            name: "fn_b",
            id: "b1",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "y", type: { text: "common_t *", refs: [{ name: "common_t", refid: "r1" }] }, description: "" },
            ],
            brief: "", description: "", returnDescription: "",
            retvalDescriptions: new Map(), exceptions: new Map(),
            notes: [], warnings: [], seeAlso: [], isStatic: false,
            additionalSections: {},
          },
        ],
      }),
    ];

    const result = buildTypeHubCounts(compounds);
    expect(result.get("common_t")).toBe(2);
  });

  it("should count same file only once for multiple references", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "a.h",
        path: "a.h",
        functions: [
          {
            name: "fn_1",
            id: "a1",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "x", type: { text: "my_t", refs: [{ name: "my_t", refid: "r1" }] }, description: "" },
            ],
            brief: "", description: "", returnDescription: "",
            retvalDescriptions: new Map(), exceptions: new Map(),
            notes: [], warnings: [], seeAlso: [], isStatic: false,
            additionalSections: {},
          },
          {
            name: "fn_2",
            id: "a2",
            returnType: { text: "void", refs: [] },
            params: [
              { name: "y", type: { text: "my_t", refs: [{ name: "my_t", refid: "r1" }] }, description: "" },
            ],
            brief: "", description: "", returnDescription: "",
            retvalDescriptions: new Map(), exceptions: new Map(),
            notes: [], warnings: [], seeAlso: [], isStatic: false,
            additionalSections: {},
          },
        ],
      }),
    ];

    const result = buildTypeHubCounts(compounds);
    expect(result.get("my_t")).toBe(1);
  });
});

describe("buildTransitiveIncludes", () => {
  it("should compute BFS transitive closure", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "a.h",
        path: "a.h",
        includes: [{ name: "b.h", local: true }],
      }),
      makeFile({
        name: "b.h",
        path: "b.h",
        includes: [{ name: "c.h", local: true }],
      }),
      makeFile({
        name: "c.h",
        path: "c.h",
        includes: [],
      }),
    ];

    const result = buildTransitiveIncludes(compounds);

    // a.h includes b.h directly, c.h transitively
    expect(result.has("a.h")).toBe(true);
    expect(result.get("a.h")!.has("b.h")).toBe(true);
    expect(result.get("a.h")!.has("c.h")).toBe(true);

    // b.h includes c.h directly
    expect(result.has("b.h")).toBe(true);
    expect(result.get("b.h")!.has("c.h")).toBe(true);

    // c.h includes nothing
    expect(result.has("c.h")).toBe(false);
  });

  it("should handle cycles without infinite loop", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "a.h",
        path: "a.h",
        includes: [{ name: "b.h", local: true }],
      }),
      makeFile({
        name: "b.h",
        path: "b.h",
        includes: [{ name: "a.h", local: true }],
      }),
    ];

    const result = buildTransitiveIncludes(compounds);
    expect(result.get("a.h")!.has("b.h")).toBe(true);
    expect(result.get("b.h")!.has("a.h")).toBe(true);
  });

  it("should skip includes for files not in the compound set", () => {
    const compounds: DoxygenCompound[] = [
      makeFile({
        name: "a.h",
        path: "a.h",
        includes: [
          { name: "b.h", local: true },
          { name: "stdio.h", local: false },
        ],
      }),
      makeFile({
        name: "b.h",
        path: "b.h",
        includes: [],
      }),
    ];

    const result = buildTransitiveIncludes(compounds);
    expect(result.get("a.h")!.has("b.h")).toBe(true);
    expect(result.get("a.h")!.has("stdio.h")).toBeFalsy();
  });
});

describe("analyze", () => {
  it("should return all analysis maps from a parse result", () => {
    const parseResult: ParseResult = {
      compounds: [
        makeFile({
          name: "foo.h",
          path: "foo.h",
          functions: [
            {
              name: "foo_set",
              id: "f1",
              returnType: { text: "void", refs: [] },
              params: [
                { name: "val", type: { text: "foo_t", refs: [{ name: "foo_t", refid: "r1" }] }, description: "" },
              ],
              brief: "", description: "", returnDescription: "",
              retvalDescriptions: new Map(), exceptions: new Map(),
              notes: [], warnings: [], seeAlso: [], isStatic: false,
              additionalSections: {},
            },
          ],
          typedefs: [
            {
              name: "foo_cb_t",
              id: "td1",
              type: { text: "void (*)(int)", refs: [] },
              definition: "typedef void (*foo_cb_t)(int)",
              brief: "",
              description: "",
              additionalSections: {},
            },
          ],
          includes: [{ name: "bar.h", local: true }],
        }),
        makeFile({ name: "foo_private.h", path: "foo_private.h" }),
        makeFile({ name: "bar.h", path: "bar.h" }),
      ],
      files: [],
      index: {},
      warnings: [],
    };

    const result = analyze(parseResult);

    expect(result.typeUsage.has("foo_t")).toBe(true);
    expect(result.privateHeaderPairs.has("foo.h")).toBe(true);
    expect(result.callbackTypedefs.has("foo_cb_t")).toBe(true);
    expect(result.typeHubCounts.get("foo_t")).toBe(1);
    expect(result.transitiveIncludes.get("foo.h")!.has("bar.h")).toBe(true);
  });
});
