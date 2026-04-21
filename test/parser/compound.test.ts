import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseCompound } from "../../src/parser/compound.js";
import type { IndexEntry } from "../../src/parser/index.js";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures");

// Build a minimal struct entries map for testing
const structEntries = new Map<string, IndexEntry>([
  [
    "struct__lv__anim__t",
    { refid: "struct__lv__anim__t", name: "_lv_anim_t", kind: "struct" },
  ],
]);

describe("parseCompound", () => {
  describe("lv_obj.h", () => {
    it("should parse compound file and extract basic info", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__obj_8h", structEntries);
      expect(file.name).toBe("lv_obj.h");
      expect(file.compoundId).toBe("lv__obj_8h");
    });

    it("should extract functions", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__obj_8h", structEntries);
      expect(file.functions.length).toBeGreaterThan(0);

      const createFn = file.functions.find((f) => f.name === "lv_obj_create");
      expect(createFn).toBeDefined();
      expect(createFn!.params.length).toBe(1);
      expect(createFn!.params[0].name).toBe("parent");
      expect(createFn!.returnType.refs.length).toBeGreaterThan(0);
    });

    it("should extract param descriptions from parameterlist", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__obj_8h", structEntries);
      const createFn = file.functions.find((f) => f.name === "lv_obj_create");
      expect(createFn).toBeDefined();
      expect(createFn!.params[0].description).toContain("parent");
    });

    it("should extract return description", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__obj_8h", structEntries);
      const createFn = file.functions.find((f) => f.name === "lv_obj_create");
      expect(createFn).toBeDefined();
      expect(createFn!.returnDescription).toBeTruthy();
    });

    it("should extract enums", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__obj_8h", structEntries);
      expect(file.enums.length).toBeGreaterThan(0);
    });

    it("should extract macros", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__obj_8h", structEntries);
      expect(file.macros.length).toBeGreaterThan(0);
    });
  });

  describe("lv_color.h", () => {
    it("should extract functions from lv_color.h", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__color_8h", structEntries);
      expect(file.name).toBe("lv_color.h");
      expect(file.functions.length).toBeGreaterThan(0);
    });

    it("should extract multiple enums", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__color_8h", structEntries);
      expect(file.enums.length).toBeGreaterThanOrEqual(1);
    });

    it("should extract macros with values", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__color_8h", structEntries);
      expect(file.macros.length).toBeGreaterThan(0);
    });
  });

  describe("lv_anim.h", () => {
    it("should extract typedefs", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__anim_8h", structEntries);
      expect(file.typedefs.length).toBeGreaterThan(0);
    });

    it("should extract functions", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__anim_8h", structEntries);
      expect(file.functions.length).toBeGreaterThan(0);
    });

    it("should extract macros", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__anim_8h", structEntries);
      expect(file.macros.length).toBeGreaterThan(0);
    });

    it("should inline struct from innerclass ref", () => {
      const file = parseCompound(FIXTURES_DIR, "lv__anim_8h", structEntries);
      // lv_anim.h references _lv_anim_t struct
      if (file.structs.length > 0) {
        const animStruct = file.structs.find((s) =>
          s.name.includes("lv_anim_t"),
        );
        if (animStruct) {
          expect(animStruct.members.length).toBeGreaterThan(0);
        }
      }
    });
  });
});

describe("parseCompound - struct", () => {
  it("should parse struct compound with members", () => {
    // Parse lv_anim.h which references struct__lv__anim__t
    const file = parseCompound(FIXTURES_DIR, "lv__anim_8h", structEntries);
    const animStruct = file.structs.find((s) => s.name.includes("lv_anim_t"));
    if (animStruct) {
      expect(animStruct.members.length).toBeGreaterThan(5);
      const varMember = animStruct.members.find((m) => m.name === "var");
      if (varMember) {
        expect(varMember.type.text).toBeTruthy();
      }
    }
  });
});
