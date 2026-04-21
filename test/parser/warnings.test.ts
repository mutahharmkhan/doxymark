import { describe, it, expect } from "vitest";
import { createWarningCollector, createNullCollector } from "../../src/parser/warnings.js";

describe("WarningCollector", () => {
  it("should collect warnings", () => {
    const collector = createWarningCollector();
    collector.warn("test warning 1");
    collector.warn("test warning 2");

    const warnings = collector.getWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toBe("test warning 1");
    expect(warnings[1]).toBe("test warning 2");
  });

  it("should return empty array when no warnings", () => {
    const collector = createWarningCollector();
    expect(collector.getWarnings()).toHaveLength(0);
  });

  it("should accumulate warnings across multiple calls", () => {
    const collector = createWarningCollector();
    for (let i = 0; i < 10; i++) {
      collector.warn(`warning ${i}`);
    }
    expect(collector.getWarnings()).toHaveLength(10);
  });
});

describe("NullCollector", () => {
  it("should silently discard warnings", () => {
    const collector = createNullCollector();
    collector.warn("this is ignored");
    expect(collector.getWarnings()).toHaveLength(0);
  });
});
