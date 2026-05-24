/**
 * Path-based loop detector.
 *
 * Each ThinkNode carries an immutable Map<string, number> of path signatures —
 * mapping (toolName:argsHash) → call-count for every ToolNode executed on the
 * path from root down to that ThinkNode.
 *
 * A branch is pruned when the same (tool, args) pair has been called
 * `maxRepeats` times on the current path. Using path-local counts (not global
 * dedup) means the same tool can be called in different branches freely.
 */
export class LoopDetector {
    constructor(private readonly maxRepeats: number = 2) {}

    /** True if this (toolName, args) has already been called maxRepeats times on this path. */
    public wouldLoop(
        pathSignatures: Map<string, number>,
        toolName: string,
        args: Record<string, unknown>
    ): boolean {
        const sig = this.signature(toolName, args);
        return (pathSignatures.get(sig) ?? 0) >= this.maxRepeats;
    }

    /**
     * Returns a NEW Map with the count for this signature incremented by 1.
     * The original map is never mutated — siblings share the parent map safely.
     */
    public extendPath(
        pathSignatures: Map<string, number>,
        toolName: string,
        args: Record<string, unknown>
    ): Map<string, number> {
        const sig = this.signature(toolName, args);
        const next = new Map(pathSignatures);
        next.set(sig, (next.get(sig) ?? 0) + 1);
        return next;
    }

    private signature(toolName: string, args: Record<string, unknown>): string {
        return `${toolName}:${this.stableHash(args)}`;
    }

    /**
     * Deterministic hash: sort keys recursively → JSON.stringify → djb2.
     * Ensures {b:1,a:2} and {a:2,b:1} produce the same signature.
     */
    private stableHash(args: Record<string, unknown>): string {
        const sorted = this.sortKeysDeep(args);
        const str = JSON.stringify(sorted);
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul((h << 5) + h, 1) + str.charCodeAt(i);
            h = h | 0;
        }
        return (h >>> 0).toString(36);
    }

    private sortKeysDeep(val: unknown): unknown {
        if (Array.isArray(val)) return val.map(v => this.sortKeysDeep(v));
        if (val !== null && typeof val === 'object') {
            return Object.keys(val as object)
                .sort()
                .reduce((acc: Record<string, unknown>, k) => {
                    acc[k] = this.sortKeysDeep((val as Record<string, unknown>)[k]);
                    return acc;
                }, {});
        }
        return val;
    }
}
