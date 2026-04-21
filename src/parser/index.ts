import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type {
  ParseResult,
  DoxygenFile,
  DoxygenCompound,
} from "./types.js";
import {
  parseCompound,
  parseClassCompound,
  parseNamespaceCompound,
  parseGroupCompound,
  parsePageCompound,
} from "./compound.js";
import { buildSymbolIndex, resolveRefs, resolveDescriptionRefs } from "./symbol-index.js";
import { createWarningCollector, type WarningCollector } from "./warnings.js";
import type { PONode } from "./xml-helpers.js";
import { getChild, getText, getAttr, findChildren } from "./xml-helpers.js";

export interface IndexEntry {
  refid: string;
  name: string;
  kind: string;
}

const RELEVANT_KINDS = new Set(["file", "struct", "union", "class", "namespace", "group", "page", "example"]);

/** Compound kinds that are known-unsupported but should warn */
const WARN_COMPOUND_KINDS = new Set([
  "interface",
  "protocol",
  "category",
  "service",
  "singleton",
  "exception",
  "type",
  "concept",
  "module",
  "requirement",
]);

/** Compound kinds that are structural and silently skipped */
const SILENT_SKIP_KINDS = new Set(["dir"]);

function parseIndexWithWarnings(
  inputDir: string,
  collector?: WarningCollector,
): { entries: IndexEntry[] } {
  const xmlPath = join(inputDir, "index.xml");
  const xml = readFileSync(xmlPath, "utf-8");

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: false,
  });

  const doc = parser.parse(xml) as PONode[];

  // Find the doxygenindex root element
  const doxygenIndexChildren = getChild(doc, "doxygenindex");
  if (!doxygenIndexChildren) return { entries: [] };

  // Find all compound elements
  const compoundNodes = findChildren(doxygenIndexChildren, "compound");

  const entries: IndexEntry[] = [];

  for (const compoundNode of compoundNodes) {
    const kind = getAttr(compoundNode, "kind") ?? "";
    const refid = getAttr(compoundNode, "refid") ?? "";
    const children = compoundNode["compound"] as PONode[];
    const name = getText(getChild(children, "name") ?? []);

    if (RELEVANT_KINDS.has(kind)) {
      entries.push({ refid, name, kind });
    } else if (collector && WARN_COMPOUND_KINDS.has(kind)) {
      collector.warn(`Skipping unsupported compound kind "${kind}": ${name}`);
    }
  }

  return { entries };
}

export function parseIndex(inputDir: string): IndexEntry[] {
  return parseIndexWithWarnings(inputDir).entries;
}

export async function parse(inputDir: string): Promise<ParseResult> {
  const collector = createWarningCollector();

  // Parse index.xml once and extract both entries and warnings
  const { entries: indexEntries } = parseIndexWithWarnings(inputDir, collector);

  // Separate entries by kind
  const fileEntries = indexEntries.filter((e) => e.kind === "file");
  const classEntries = indexEntries.filter((e) => e.kind === "class");
  const namespaceEntries = indexEntries.filter((e) => e.kind === "namespace");
  const groupEntries = indexEntries.filter((e) => e.kind === "group");
  const pageEntries = indexEntries.filter((e) => e.kind === "page" || e.kind === "example");

  const structEntries = new Map(
    indexEntries
      .filter((e) => e.kind === "struct" || e.kind === "union")
      .map((e) => [e.refid, e]),
  );

  const compounds: DoxygenCompound[] = [];

  function parseEntries(
    entries: IndexEntry[],
    parseFn: (refid: string) => DoxygenCompound,
    label: string,
  ): void {
    for (const entry of entries) {
      if (!existsSync(join(inputDir, `${entry.refid}.xml`))) continue;
      try {
        compounds.push(parseFn(entry.refid));
      } catch (e) {
        collector.warn(
          `Failed to parse ${label} ${entry.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  parseEntries(fileEntries, (refid) => parseCompound(inputDir, refid, structEntries, collector), "file");
  parseEntries(classEntries, (refid) => parseClassCompound(inputDir, refid, collector), "class");
  parseEntries(namespaceEntries, (refid) => parseNamespaceCompound(inputDir, refid, structEntries, collector), "namespace");
  parseEntries(groupEntries, (refid) => parseGroupCompound(inputDir, refid, structEntries, collector), "group");
  parseEntries(pageEntries, (refid) => parsePageCompound(inputDir, refid, collector), "page");

  // Filtered view for backwards compat
  const files = compounds.filter((c): c is DoxygenFile => c.kind === "file");

  const { index, refidMap } = buildSymbolIndex(compounds, collector);
  resolveRefs(compounds, index, refidMap);
  resolveDescriptionRefs(compounds, refidMap);

  return { compounds, files, index, warnings: collector.getWarnings() };
}
