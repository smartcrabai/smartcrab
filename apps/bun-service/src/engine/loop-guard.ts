/**
 * TypeScript port of `crates/smartcrab-app/src-tauri/src/engine/loop_guard.rs`.
 *
 * Tracks per-node iteration counts and throws when the configured maximum is
 * exceeded. Used by the executor to prevent unbounded loops when conditional
 * routing creates cycles in the pipeline graph.
 */
export class LoopGuard {
  private readonly counts = new Map<string, number>();

  constructor(private readonly maxCount: number) {}

  /**
   * Increment the counter for `nodeId` and return the new count.
   *
   * @throws if incrementing would exceed `maxCount`.
   */
  checkAndIncrement(nodeId: string): number {
    const next = (this.counts.get(nodeId) ?? 0) + 1;
    this.counts.set(nodeId, next);
    if (next > this.maxCount) {
      throw new Error(
        `Loop limit ${this.maxCount} exceeded for node '${nodeId}'`,
      );
    }
    return next;
  }

  /**
   * Predicate variant matching the unit-spec `tick(nodeId): bool` signature.
   * Returns `true` while the node is still within its budget, `false` once
   * it has exceeded the limit.
   */
  tick(nodeId: string): boolean {
    try {
      this.checkAndIncrement(nodeId);
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.counts.clear();
  }
}
