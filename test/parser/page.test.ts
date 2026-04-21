import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parsePageCompound } from "../../src/parser/compound.js";
import { createWarningCollector } from "../../src/parser/warnings.js";

const CPP_FIXTURES = join(import.meta.dirname, "../fixtures/cpp");

describe("parsePageCompound", () => {
  it("should parse basic page info", () => {
    const collector = createWarningCollector();
    const page = parsePageCompound(CPP_FIXTURES, "page__mypage", collector);

    expect(page.kind).toBe("page");
    expect(page.name).toBe("mypage");
    expect(page.compoundId).toBe("page__mypage");
    expect(page.title).toBe("Getting Started");
  });

  it("should extract brief and description", () => {
    const collector = createWarningCollector();
    const page = parsePageCompound(CPP_FIXTURES, "page__mypage", collector);

    expect(page.brief).toContain("getting started");
    expect(page.description).toContain("install and configure");
  });

  it("should derive a sanitized path", () => {
    const collector = createWarningCollector();
    const page = parsePageCompound(CPP_FIXTURES, "page__mypage", collector);

    expect(page.path).toBe("mypage");
  });
});
