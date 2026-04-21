import type {
  ParseResult,
  DoxygenCompound,
  DoxygenFunction,
  DoxygenFile,
} from "../parser/types.js";
import { filePathToPagePath } from "../parser/utils.js";
import type { AnalysisResult, TypeUsageEntry } from "./types.js";

export function analyze(parseResult: ParseResult): AnalysisResult {
  const compounds = parseResult.compounds ?? parseResult.files;
  return {
    typeUsage: buildTypeUsage(compounds),
    privateHeaderPairs: buildPrivateHeaderPairs(compounds),
    callbackTypedefs: buildCallbackTypedefs(compounds),
    typeHubCounts: buildTypeHubCounts(compounds),
    transitiveIncludes: buildTransitiveIncludes(compounds),
  };
}

/** Scan all functions' params to build typeName -> [functions that accept it] */
export function buildTypeUsage(compounds: DoxygenCompound[]): Map<string, TypeUsageEntry[]> {
  const result = new Map<string, TypeUsageEntry[]>();

  for (const compound of compounds) {
    const functions = getFunctions(compound);
    const filePath = compound.path;

    for (const fn of functions) {
      for (let i = 0; i < fn.params.length; i++) {
        const param = fn.params[i];
        for (const ref of param.type.refs) {
          if (!result.has(ref.name)) {
            result.set(ref.name, []);
          }
          result.get(ref.name)!.push({
            functionName: fn.name,
            filePath,
            paramIndex: i,
            paramName: param.name,
          });
        }
      }
    }
  }

  return result;
}

/** Match foo.h <-> foo_private.h pairs using page paths */
export function buildPrivateHeaderPairs(compounds: DoxygenCompound[]): Map<string, string> {
  const result = new Map<string, string>();
  const fileCompounds = compounds.filter((c): c is DoxygenFile => c.kind === "file");

  // Build name -> page path map
  const nameToPagePath = new Map<string, string>();
  for (const file of fileCompounds) {
    nameToPagePath.set(file.name, filePathToPagePath(file.path));
  }

  for (const file of fileCompounds) {
    const name = file.name;
    if (name.endsWith("_private.h")) {
      const publicName = name.replace("_private.h", ".h");
      const publicPath = nameToPagePath.get(publicName);
      if (publicPath) {
        const privatePath = filePathToPagePath(file.path);
        result.set(name, publicPath);
        result.set(publicName, privatePath);
      }
    }
  }

  return result;
}

/** Find callback typedefs (function pointers) by checking for (* in definition */
export function buildCallbackTypedefs(compounds: DoxygenCompound[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const compound of compounds) {
    if (compound.kind !== "file" && compound.kind !== "namespace" && compound.kind !== "group") continue;

    const typedefs = compound.typedefs;
    for (const td of typedefs) {
      const def = td.definition || td.type.text;
      if (def && def.includes("(*")) {
        result.set(td.name, td.definition || `${td.type.text} ${td.name}`);
      }
    }
  }

  return result;
}

/** Count how many distinct files reference each type name in function params */
export function buildTypeHubCounts(compounds: DoxygenCompound[]): Map<string, number> {
  const typeToFiles = new Map<string, Set<string>>();

  for (const compound of compounds) {
    const functions = getFunctions(compound);
    const filePath = compound.path;

    for (const fn of functions) {
      for (const param of fn.params) {
        for (const ref of param.type.refs) {
          if (!typeToFiles.has(ref.name)) {
            typeToFiles.set(ref.name, new Set());
          }
          typeToFiles.get(ref.name)!.add(filePath);
        }
      }
    }
  }

  const result = new Map<string, number>();
  for (const [typeName, files] of typeToFiles) {
    result.set(typeName, files.size);
  }
  return result;
}

/** BFS on include graph to compute transitive closure per file */
export function buildTransitiveIncludes(compounds: DoxygenCompound[]): Map<string, Set<string>> {
  const fileCompounds = compounds.filter((c): c is DoxygenFile => c.kind === "file");

  // Build adjacency list: name -> [included names that exist as files]
  const nameSet = new Set(fileCompounds.map((f) => f.name));
  const adjacency = new Map<string, string[]>();

  for (const file of fileCompounds) {
    const includes: string[] = [];
    for (const inc of file.includes) {
      if (nameSet.has(inc.name)) {
        includes.push(inc.name);
      }
    }
    adjacency.set(file.name, includes);
  }

  // BFS from each file
  const result = new Map<string, Set<string>>();
  for (const file of fileCompounds) {
    const visited = new Set<string>();
    const queue = adjacency.get(file.name) ?? [];
    for (const q of queue) {
      visited.add(q);
    }
    let idx = 0;
    while (idx < queue.length) {
      const current = queue[idx++];
      const neighbors = adjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && neighbor !== file.name) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (visited.size > 0) {
      result.set(file.name, visited);
    }
  }

  return result;
}

/** Extract functions from any compound type */
function getFunctions(compound: DoxygenCompound): DoxygenFunction[] {
  switch (compound.kind) {
    case "file":
    case "namespace":
    case "group":
      return compound.functions;
    case "class":
      return compound.accessSections.flatMap((s) => s.functions);
    case "page":
      return [];
  }
}
