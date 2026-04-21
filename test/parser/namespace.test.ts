import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseNamespaceCompound } from "../../src/parser/compound.js";
import { createWarningCollector } from "../../src/parser/warnings.js";
import type { IndexEntry } from "../../src/parser/index.js";

const CPP_FIXTURES = join(import.meta.dirname, "../fixtures/cpp");

const structEntries = new Map<string, IndexEntry>([
  [
    "structmylib_1_1Vec3",
    { refid: "structmylib_1_1Vec3", name: "mylib::Vec3", kind: "struct" },
  ],
]);

describe("parseNamespaceCompound", () => {
  it("should parse basic namespace info", () => {
    const collector = createWarningCollector();
    const ns = parseNamespaceCompound(
      CPP_FIXTURES,
      "namespacemylib",
      structEntries,
      collector,
    );

    expect(ns.kind).toBe("namespace");
    expect(ns.name).toBe("mylib");
    expect(ns.compoundId).toBe("namespacemylib");
    expect(ns.brief).toContain("main library namespace");
  });

  it("should extract functions", () => {
    const collector = createWarningCollector();
    const ns = parseNamespaceCompound(
      CPP_FIXTURES,
      "namespacemylib",
      structEntries,
      collector,
    );

    expect(ns.functions.length).toBe(2);
    const init = ns.functions.find((f) => f.name === "init");
    expect(init).toBeDefined();
    expect(init!.brief).toContain("Initialize");

    const shutdown = ns.functions.find((f) => f.name === "shutdown");
    expect(shutdown).toBeDefined();
  });

  it("should extract typedefs", () => {
    const collector = createWarningCollector();
    const ns = parseNamespaceCompound(
      CPP_FIXTURES,
      "namespacemylib",
      structEntries,
      collector,
    );

    expect(ns.typedefs.length).toBe(1);
    expect(ns.typedefs[0].name).toBe("callback_t");
  });

  it("should extract enums", () => {
    const collector = createWarningCollector();
    const ns = parseNamespaceCompound(
      CPP_FIXTURES,
      "namespacemylib",
      structEntries,
      collector,
    );

    expect(ns.enums.length).toBe(1);
    expect(ns.enums[0].name).toBe("LogLevel");
    expect(ns.enums[0].values.length).toBe(3);
    expect(ns.enums[0].values[0].name).toBe("Debug");
  });

  it("should extract inner namespaces", () => {
    const collector = createWarningCollector();
    const ns = parseNamespaceCompound(
      CPP_FIXTURES,
      "namespacemylib",
      structEntries,
      collector,
    );

    expect(ns.namespaces.length).toBe(1);
    expect(ns.namespaces[0]).toBe("mylib::detail");
  });

  it("should derive path from namespace name", () => {
    const collector = createWarningCollector();
    const ns = parseNamespaceCompound(
      CPP_FIXTURES,
      "namespacemylib",
      structEntries,
      collector,
    );

    expect(ns.path).toBe("mylib");
  });
});
