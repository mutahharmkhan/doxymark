export interface WarningCollector {
  warn(msg: string): void;
  getWarnings(): string[];
}

export function createWarningCollector(): WarningCollector {
  const warnings: string[] = [];
  return {
    warn(msg: string) {
      warnings.push(msg);
    },
    getWarnings() {
      return warnings;
    },
  };
}

/** No-op collector for contexts where warnings aren't tracked. */
export function createNullCollector(): WarningCollector {
  return {
    warn() {},
    getWarnings() {
      return [];
    },
  };
}
