// Typed, dot-path accessors over a plain config object. Pure and platform-free.
// Deliberately duplicated from @kiskis/web (37 lines) rather than shared: the two
// packages install independently and neither should drag the other's dependencies.

export class KiskisConfig {
  constructor(private readonly data: Record<string, unknown>) {}

  /** Raw underlying object (already signature-verified). */
  raw(): Record<string, unknown> {
    return this.data;
  }

  private get(path: string): unknown {
    let cur: unknown = this.data;
    for (const part of path.split('.')) {
      if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  bool(path: string, fallback = false): boolean {
    const v = this.get(path);
    return typeof v === 'boolean' ? v : fallback;
  }

  string(path: string): string | undefined {
    const v = this.get(path);
    return typeof v === 'string' ? v : undefined;
  }

  int(path: string): number | undefined {
    const v = this.get(path);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
}
