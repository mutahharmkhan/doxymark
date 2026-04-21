import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseClassCompound } from "../../src/parser/compound.js";
import { createWarningCollector } from "../../src/parser/warnings.js";

const CPP_FIXTURES = join(import.meta.dirname, "../fixtures/cpp");

describe("parseClassCompound", () => {
  it("should parse basic class info", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    expect(cls.kind).toBe("class");
    expect(cls.name).toBe("MyClass");
    expect(cls.compoundId).toBe("classMyClass");
    expect(cls.brief).toContain("template class");
  });

  it("should extract template params", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    expect(cls.templateParams).toBeDefined();
    expect(cls.templateParams!.length).toBe(2);
    expect(cls.templateParams![0].name).toBe("T");
    expect(cls.templateParams![0].type.text).toBe("typename");
    expect(cls.templateParams![1].name).toBe("N");
    expect(cls.templateParams![1].defaultValue).toBe("10");
  });

  it("should extract base classes", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    expect(cls.baseClasses.length).toBe(1);
    expect(cls.baseClasses[0].name).toBe("Base");
    expect(cls.baseClasses[0].protection).toBe("public");
    expect(cls.baseClasses[0].virtual).toBe(false);
  });

  it("should extract derived classes", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    expect(cls.derivedClasses.length).toBe(1);
    expect(cls.derivedClasses[0].name).toBe("Derived");
  });

  it("should extract public functions", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    const publicSection = cls.accessSections.find((s) => s.access === "public");
    expect(publicSection).toBeDefined();
    expect(publicSection!.functions.length).toBeGreaterThanOrEqual(2);

    const create = publicSection!.functions.find((f) => f.name === "create");
    expect(create).toBeDefined();
    expect(create!.params.length).toBe(1);
    expect(create!.params[0].name).toBe("name");
    expect(create!.params[0].direction).toBe("in");
  });

  it("should extract C++ function attributes", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    const publicSection = cls.accessSections.find((s) => s.access === "public");
    const getValue = publicSection!.functions.find((f) => f.name === "getValue");
    expect(getValue).toBeDefined();
    expect(getValue!.isConst).toBe(true);
    expect(getValue!.isNoexcept).toBe(true);
    expect(getValue!.virtualKind).toBe("virtual");
    expect(getValue!.argsstring).toBe("() const noexcept");

    const instance = publicSection!.functions.find((f) => f.name === "instance");
    expect(instance).toBeDefined();
    expect(instance!.isStatic).toBe(true);
    expect(instance!.isInline).toBe(true);
    expect(instance!.isConstexpr).toBe(true);
  });

  it("should extract protected functions", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    const protectedSection = cls.accessSections.find(
      (s) => s.access === "protected",
    );
    expect(protectedSection).toBeDefined();

    const doWork = protectedSection!.functions.find((f) => f.name === "doWork");
    expect(doWork).toBeDefined();
    expect(doWork!.virtualKind).toBe("pure-virtual");
  });

  it("should extract private variables", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    const privateSection = cls.accessSections.find((s) => s.access === "private");
    expect(privateSection).toBeDefined();
    expect(privateSection!.variables.length).toBe(1);
    expect(privateSection!.variables[0].name).toBe("m_value");
  });

  it("should extract public typedefs", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    const publicSection = cls.accessSections.find((s) => s.access === "public");
    expect(publicSection!.typedefs.length).toBe(1);
    expect(publicSection!.typedefs[0].name).toBe("value_type");
  });

  it("should extract friends", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    expect(cls.friends.length).toBe(1);
    expect(cls.friends[0].name).toBe("Helper");
    expect(cls.friends[0].type.text).toBe("class");
  });

  it("should derive path from location", () => {
    const collector = createWarningCollector();
    const cls = parseClassCompound(CPP_FIXTURES, "classMyClass", collector);

    expect(cls.path).toBe("myclass.h");
  });
});
