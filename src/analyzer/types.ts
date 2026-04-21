export interface AnalysisResult {
  /** typeName -> [functions that accept it as a parameter] */
  typeUsage: Map<string, TypeUsageEntry[]>;
  /** fileName -> paired private/public counterpart page path */
  privateHeaderPairs: Map<string, string>;
  /** typedefName -> full signature string (for callback typedefs) */
  callbackTypedefs: Map<string, string>;
  /** typeName -> count of distinct files referencing it */
  typeHubCounts: Map<string, number>;
  /** filePath -> set of all transitively included file paths */
  transitiveIncludes: Map<string, Set<string>>;
}

export interface TypeUsageEntry {
  functionName: string;
  filePath: string;
  paramIndex: number;
  paramName: string;
}
