import { describe, it, expect } from "vitest";
import { parseTypeRef } from "../../src/parser/type-ref.js";

// Helper to build preserveOrder nodes
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

describe("parseTypeRef", () => {
  it("should handle a simple string type", () => {
    const result = parseTypeRef("void");
    expect(result.text).toBe("void");
    expect(result.refs).toHaveLength(0);
  });

  it("should handle undefined/null", () => {
    expect(parseTypeRef(undefined).text).toBe("");
    expect(parseTypeRef(null).text).toBe("");
  });

  it("should handle a number", () => {
    const result = parseTypeRef(42);
    expect(result.text).toBe("42");
  });

  it("should handle an array with only #text", () => {
    const result = parseTypeRef([text("int")]);
    expect(result.text).toBe("int");
    expect(result.refs).toHaveLength(0);
  });

  it("should handle an array with a single ref", () => {
    // XML: <type>const <ref refid="structlv__obj__t">lv_obj_t</ref> *</type>
    const result = parseTypeRef([
      text("const "),
      po("ref", [text("lv_obj_t")], { refid: "structlv__obj__t" }),
      text(" *"),
    ]);
    expect(result.text).toBe("const lv_obj_t *");
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].name).toBe("lv_obj_t");
    expect(result.refs[0].refid).toBe("structlv__obj__t");
  });

  it("should handle an array with multiple refs", () => {
    // XML: <type><ref refid="a">lv_color_t</ref><ref refid="b">lv_opa_t</ref> *</type>
    const result = parseTypeRef([
      po("ref", [text("lv_color_t")], { refid: "structlv__color__t" }),
      po("ref", [text("lv_opa_t")], { refid: "lv__opa__t" }),
      text(" *"),
    ]);
    expect(result.refs).toHaveLength(2);
    expect(result.refs[0].name).toBe("lv_color_t");
    expect(result.refs[1].name).toBe("lv_opa_t");
    expect(result.text).toBe("lv_color_tlv_opa_t *");
  });

  it("should handle an array with no #text but with ref", () => {
    const result = parseTypeRef([
      po("ref", [text("lv_obj_t")], { refid: "structlv__obj__t" }),
    ]);
    expect(result.text).toBe("lv_obj_t");
    expect(result.refs).toHaveLength(1);
  });

  it("should correctly interleave text and refs", () => {
    // XML: <type>const <ref>A</ref> &amp; <ref>B</ref> *</type>
    const result = parseTypeRef([
      text("const "),
      po("ref", [text("A")], { refid: "a" }),
      text(" & "),
      po("ref", [text("B")], { refid: "b" }),
      text(" *"),
    ]);
    expect(result.text).toBe("const A & B *");
    expect(result.refs).toHaveLength(2);
  });
});
