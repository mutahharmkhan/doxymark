import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseIndex } from "../../src/parser/index.js";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures");

describe("parseIndex", () => {
  it("should parse index.xml and return compound entries", () => {
    const entries = parseIndex(FIXTURES_DIR);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("should only include relevant kinds", () => {
    const entries = parseIndex(FIXTURES_DIR);
    const kinds = new Set(entries.map((e) => e.kind));
    const relevantKinds = ["file", "struct", "union", "class", "namespace", "group", "page", "example"];
    for (const kind of kinds) {
      expect(relevantKinds).toContain(kind);
    }
  });

  it("should include file compounds", () => {
    const entries = parseIndex(FIXTURES_DIR);
    const fileEntries = entries.filter((e) => e.kind === "file");
    expect(fileEntries.length).toBeGreaterThan(0);
  });

  it("should include struct compounds", () => {
    const entries = parseIndex(FIXTURES_DIR);
    const structEntries = entries.filter((e) => e.kind === "struct");
    expect(structEntries.length).toBeGreaterThan(0);
  });

  it("should have refid and name for each entry", () => {
    const entries = parseIndex(FIXTURES_DIR);
    for (const entry of entries) {
      expect(entry.refid).toBeTruthy();
      expect(entry.name).toBeTruthy();
    }
  });

  it("should include known LVGL files", () => {
    const entries = parseIndex(FIXTURES_DIR);
    const names = entries.map((e) => e.name);
    expect(names).toContain("lv_obj.h");
  });
});
