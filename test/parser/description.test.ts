import { describe, it, expect } from "vitest";
import { parseDescription, parseBriefDescription } from "../../src/parser/description.js";
import { createWarningCollector } from "../../src/parser/warnings.js";

// Helper to build preserveOrder nodes more concisely
function po(tag: string, children: unknown[], attrs?: Record<string, string>): Record<string, unknown> {
  const node: Record<string, unknown> = { [tag]: children };
  if (attrs) {
    const attrObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      attrObj[`@_${k}`] = v;
    }
    node[":@"] = attrObj;
  }
  return node;
}

function text(s: string): Record<string, unknown> {
  return { "#text": s };
}

describe("parseDescription", () => {
  describe("simplesect kinds", () => {
    it("should handle pre simplesect", () => {
      const node = [
        po("para", [
          po("simplesect", [po("para", [text("Must call init first")])], { kind: "pre" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.additionalSections["pre"]).toContain("Must call init first");
    });

    it("should handle post simplesect", () => {
      const node = [
        po("para", [
          po("simplesect", [po("para", [text("Object is initialized")])], { kind: "post" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.additionalSections["post"]).toContain("Object is initialized");
    });

    it("should handle invariant simplesect", () => {
      const node = [
        po("para", [
          po("simplesect", [po("para", [text("Size > 0")])], { kind: "invariant" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.additionalSections["invariant"]).toContain("Size > 0");
    });

    it("should handle par simplesect with title", () => {
      const node = [
        po("para", [
          po("simplesect", [
            po("title", [text("Custom Section")]),
            po("para", [text("Custom content")]),
          ], { kind: "par" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.additionalSections["Custom Section"]).toBeDefined();
    });

    it("should handle copyright simplesect", () => {
      const node = [
        po("para", [
          po("simplesect", [po("para", [text("2024 ACME Corp")])], { kind: "copyright" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.additionalSections["copyright"]).toContain("2024 ACME Corp");
    });

    it("should handle date simplesect", () => {
      const node = [
        po("para", [
          po("simplesect", [po("para", [text("2024-01-01")])], { kind: "date" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.additionalSections["date"]).toContain("2024-01-01");
    });

    it("should warn on unknown simplesect kind", () => {
      const collector = createWarningCollector();
      const node = [
        po("para", [
          po("simplesect", [po("para", [text("content")])], { kind: "unknownkind" }),
        ]),
      ];
      parseDescription(node, collector);
      expect(collector.getWarnings().some((w) => w.includes("Unknown simplesect kind"))).toBe(true);
    });
  });

  describe("parameterlist kinds", () => {
    it("should handle retval parameterlist", () => {
      const node = [
        po("para", [
          po("parameterlist", [
            po("parameteritem", [
              po("parameternamelist", [po("parametername", [text("0")])]),
              po("parameterdescription", [po("para", [text("Success")])]),
            ]),
          ], { kind: "retval" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.retvalDescriptions.get("0")).toBe("Success");
    });

    it("should handle exception parameterlist", () => {
      const node = [
        po("para", [
          po("parameterlist", [
            po("parameteritem", [
              po("parameternamelist", [po("parametername", [text("std::runtime_error")])]),
              po("parameterdescription", [po("para", [text("If init fails")])]),
            ]),
          ], { kind: "exception" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.exceptionDescriptions.get("std::runtime_error")).toBe("If init fails");
    });

    it("should handle templateparam parameterlist", () => {
      const node = [
        po("para", [
          po("parameterlist", [
            po("parameteritem", [
              po("parameternamelist", [po("parametername", [text("T")])]),
              po("parameterdescription", [po("para", [text("The value type")])]),
            ]),
          ], { kind: "templateparam" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.templateParamDescriptions.get("T")).toBe("The value type");
    });

    it("should handle param direction attribute", () => {
      const node = [
        po("para", [
          po("parameterlist", [
            po("parameteritem", [
              po("parameternamelist", [
                po("parametername", [text("parent")], { direction: "in" }),
              ]),
              po("parameterdescription", [po("para", [text("The parent object")])]),
            ]),
          ], { kind: "param" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.paramDirections.get("parent")).toBe("in");
      expect(result.paramDescriptions.get("parent")).toBe("The parent object");
    });

    it("should warn on unknown parameterlist kind", () => {
      const collector = createWarningCollector();
      const node = [
        po("para", [
          po("parameterlist", [
            po("parameteritem", [
              po("parameternamelist", [po("parametername", [text("x")])]),
              po("parameterdescription", [po("para", [text("value")])]),
            ]),
          ], { kind: "unknown_kind" }),
        ]),
      ];
      parseDescription(node, collector);
      expect(collector.getWarnings().some((w) => w.includes("Unknown parameterlist kind"))).toBe(true);
    });
  });

  describe("sect1-sect6", () => {
    it("should render sect1 as ##", () => {
      const node = [
        po("para", [text("intro text")]),
        po("sect1", [
          po("title", [text("Section One")]),
          po("para", [text("Section one content")]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("## Section One");
      expect(result.markdown).toContain("Section one content");
    });

    it("should render nested sect2 as ###", () => {
      const node = [
        po("sect1", [
          po("title", [text("Outer")]),
          po("para", [text("Outer content")]),
          po("sect2", [
            po("title", [text("Inner")]),
            po("para", [text("Inner content")]),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("## Outer");
      expect(result.markdown).toContain("### Inner");
    });
  });

  describe("xrefsect", () => {
    it("should render xrefsect as blockquote", () => {
      const node = [
        po("para", [
          po("xrefsect", [
            po("xreftitle", [text("Todo")]),
            po("xrefdescription", [po("para", [text("Fix this later")])]),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("> **Todo:** Fix this later");
    });
  });

  describe("block-level elements", () => {
    it("should render blockquote", () => {
      const node = [
        po("para", [
          po("blockquote", [po("para", [text("Quoted text")])]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("> ");
    });

    it("should render verbatim as fenced code block", () => {
      const node = [
        po("para", [
          po("verbatim", [text("raw text here")]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("```");
      expect(result.markdown).toContain("raw text here");
    });

    it("should render image with alt text", () => {
      const node = [
        po("para", [
          po("image", [text("alt text")], { type: "html", name: "diagram.png" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("![alt text](diagram.png)");
    });

    it("should render anchor as placeholder token", () => {
      const node = [
        po("para", [
          po("anchor", [], { id: "my-anchor" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain('{{dxanchor:my-anchor}}');
    });

    it("should render hruler as ---", () => {
      const node = [
        po("para", [text("before")]),
        po("hruler", []),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("---");
    });

    it("should render preformatted as code block", () => {
      const node = [
        po("para", [
          po("preformatted", [text("preformatted content")]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("```");
      expect(result.markdown).toContain("preformatted content");
    });

    it("should handle variablelist", () => {
      const node = [
        po("para", [
          po("variablelist", [
            po("varlistentry", [po("term", [text("key")])]),
            po("listitem", [po("para", [text("value")])]),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("**key**");
      expect(result.markdown).toContain("value");
    });

    it("should handle details element", () => {
      const node = [
        po("para", [
          po("details", [
            po("summary", [text("Click to expand")]),
            po("para", [text("Hidden content")]),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("<details>");
      expect(result.markdown).toContain("<summary>");
      expect(result.markdown).toContain("</details>");
    });
  });

  describe("inline markup", () => {
    it("should render strikethrough with s", () => {
      const node = [po("para", [po("s", [text("deleted")])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("~~deleted~~");
    });

    it("should render strikethrough with strike", () => {
      const node = [po("para", [po("strike", [text("deleted")])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("~~deleted~~");
    });

    it("should render strikethrough with del", () => {
      const node = [po("para", [po("del", [text("deleted")])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("~~deleted~~");
    });

    it("should render underline", () => {
      const node = [po("para", [po("underline", [text("underlined")])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("<u>underlined</u>");
    });

    it("should render subscript", () => {
      const node = [po("para", [po("subscript", [text("2")])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("<sub>2</sub>");
    });

    it("should render superscript", () => {
      const node = [po("para", [po("superscript", [text("2")])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("<sup>2</sup>");
    });

    it("should render nonbreakablespace", () => {
      const node = [po("para", [text("a"), po("nonbreakablespace", []), text("b")])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("a\u00A0");
      expect(result.markdown).toContain("b");
    });
  });

  describe("entity rendering", () => {
    it("should render copy entity", () => {
      const node = [po("para", [po("copy", [])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("\u00A9");
    });

    it("should render ndash entity", () => {
      const node = [po("para", [po("ndash", [])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("\u2013");
    });

    it("should render Alpha entity", () => {
      const node = [po("para", [po("Alpha", [])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("\u0391");
    });

    it("should render le entity", () => {
      const node = [po("para", [po("le", [])])];
      const result = parseDescription(node);
      expect(result.markdown).toContain("\u2264");
    });
  });

  describe("ulink", () => {
    it("should render ulink with url and text", () => {
      const node = [
        po("para", [
          po("ulink", [text("click here")], { url: "https://example.com" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("[click here](https://example.com)");
    });

    it("should render ulink with object text node", () => {
      const node = [
        po("para", [
          po("ulink", [text("Example Site")], { url: "https://example.com" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("[Example Site](https://example.com)");
    });

    it("should fall back to url when ulink has no text", () => {
      const node = [
        po("para", [
          po("ulink", [], { url: "https://example.com" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("[https://example.com](https://example.com)");
    });
  });

  describe("unknown elements", () => {
    it("should warn on unknown description elements", () => {
      const collector = createWarningCollector();
      const node = [po("para", [po("totallyunknownelement", [text("data")])])];
      parseDescription(node, collector);
      expect(
        collector.getWarnings().some((w) => w.includes("Unknown description element: <totallyunknownelement>")),
      ).toBe(true);
    });
  });

  describe("computeroutput + ref nesting", () => {
    it("should produce backtick-styled link for ref inside computeroutput", () => {
      // <computeroutput><ref refid="abc">lv_obj_flag_t</ref></computeroutput>
      const node = [
        po("para", [
          po("computeroutput", [
            po("ref", [text("lv_obj_flag_t")], { refid: "abc" }),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      // Ref inside computeroutput produces [`name`](path) directly
      expect(result.markdown).toBe("[`lv_obj_flag_t`]({{dxref:abc}})");
    });

    it("should handle mixed text and ref inside computeroutput", () => {
      // <computeroutput><ref refid="abc">LV_PART_KNOB</ref> | LV_STATE_PRESSED</computeroutput>
      const node = [
        po("para", [
          po("computeroutput", [
            po("ref", [text("LV_PART_KNOB")], { refid: "abc" }),
            text(" | LV_STATE_PRESSED"),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("[`LV_PART_KNOB`]({{dxref:abc}})` | LV_STATE_PRESSED`");
    });

    it("should keep simple backtick wrapping when no refs present", () => {
      // <computeroutput>plain_text</computeroutput>
      const node = [
        po("para", [
          po("computeroutput", [text("plain_text")]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("`plain_text`");
    });
  });

  describe(":: stripping", () => {
    it("should strip leading :: from type references in text", () => {
      const node = [
        po("para", [text("See ::TypeName for details")]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("See TypeName for details");
    });

    it("should not strip :: inside words", () => {
      const node = [
        po("para", [text("std::string is a class")]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("std::string is a class");
    });
  });

  describe("nested blockquotes", () => {
    it("should flatten nested blockquotes with single inner blockquote", () => {
      // <blockquote><blockquote><para>text</para></blockquote></blockquote>
      const node = [
        po("para", [
          po("blockquote", [
            po("blockquote", [
              po("para", [text("inner text")]),
            ]),
          ]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("> inner text");
      // Should NOT have "> > inner text" (double nesting)
      expect(result.markdown).not.toContain("> > inner text");
    });
  });

  describe("interleaving (preserveOrder fix)", () => {
    it("should correctly interleave text and computeroutput", () => {
      // "true: `obj` is in `state`"
      const node = [
        po("para", [
          text("true: "),
          po("computeroutput", [text("obj")]),
          text(" is in "),
          po("computeroutput", [text("state")]),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("true: `obj` is in `state`");
    });

    it("should correctly interleave text and ref elements", () => {
      const node = [
        po("para", [
          text("Call "),
          po("ref", [text("lv_obj_create")], { refid: "func123" }),
          text(" to make a widget"),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toContain("Call [lv_obj_create]");
      expect(result.markdown).toContain(" to make a widget");
    });

    it("should handle mixed computeroutput and ref elements", () => {
      // "Set `enabled` via lv_obj_set_flag"
      const node = [
        po("para", [
          text("Set "),
          po("computeroutput", [text("enabled")]),
          text(" via "),
          po("ref", [text("lv_obj_set_flag")], { refid: "flagfunc" }),
        ]),
      ];
      const result = parseDescription(node);
      expect(result.markdown).toBe("Set `enabled` via [lv_obj_set_flag]({{dxref:flagfunc}})");
    });
  });
});

describe("parseBriefDescription", () => {
  it("should return plain text from brief", () => {
    const result = parseBriefDescription([po("para", [text("A brief description")])]);
    expect(result).toBe("A brief description");
  });

  it("should handle string input", () => {
    const result = parseBriefDescription("Simple string");
    expect(result).toBe("Simple string");
  });

  it("should handle null input", () => {
    const result = parseBriefDescription(null);
    expect(result).toBe("");
  });
});
