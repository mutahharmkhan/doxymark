import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseGroupCompound } from "../../src/parser/compound.js";
import { createWarningCollector } from "../../src/parser/warnings.js";
import type { IndexEntry } from "../../src/parser/index.js";

const CPP_FIXTURES = join(import.meta.dirname, "../fixtures/cpp");

const structEntries = new Map<string, IndexEntry>();

describe("parseGroupCompound", () => {
  it("should parse basic group info", () => {
    const collector = createWarningCollector();
    const group = parseGroupCompound(CPP_FIXTURES, "group__mygroup", structEntries, collector);

    expect(group.kind).toBe("group");
    expect(group.name).toBe("mygroup");
    expect(group.compoundId).toBe("group__mygroup");
    expect(group.title).toBe("My Module Group");
    expect(group.brief).toContain("related APIs");
  });

  it("should extract functions", () => {
    const collector = createWarningCollector();
    const group = parseGroupCompound(CPP_FIXTURES, "group__mygroup", structEntries, collector);

    expect(group.functions.length).toBe(1);
    expect(group.functions[0].name).toBe("group_init");
    expect(group.functions[0].params.length).toBe(1);
  });

  it("should extract typedefs", () => {
    const collector = createWarningCollector();
    const group = parseGroupCompound(CPP_FIXTURES, "group__mygroup", structEntries, collector);

    expect(group.typedefs.length).toBe(1);
    expect(group.typedefs[0].name).toBe("group_handle_t");
  });

  it("should extract inner groups", () => {
    const collector = createWarningCollector();
    const group = parseGroupCompound(CPP_FIXTURES, "group__mygroup", structEntries, collector);

    expect(group.innerGroups.length).toBe(1);
    expect(group.innerGroups[0]).toBe("subgroup");
  });

  it("should derive a sanitized path", () => {
    const collector = createWarningCollector();
    const group = parseGroupCompound(CPP_FIXTURES, "group__mygroup", structEntries, collector);

    expect(group.path).toBe("mygroup");
  });
});
