/**
 * Normalize a value to an array. If already an array, return as-is.
 * If undefined/null, return empty array. Otherwise, wrap in array.
 */
export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Convert a file path like "core/lv_obj.h" to a page path like "core/lv_obj_h".
 */
export function filePathToPagePath(filePath: string): string {
  return filePath.replace(/\./g, "_");
}
