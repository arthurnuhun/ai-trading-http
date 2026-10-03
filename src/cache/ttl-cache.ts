type Entry<V> = { value: V; expiresAt: number };

export class TtlCache<V> {
  private readonly map = new Map<string, Entry<V>>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries = 200,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  clear(): void {
    this.map.clear();
  }
}
