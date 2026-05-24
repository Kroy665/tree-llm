// ─── Event Types ──────────────────────────────────────────────────────────────

export type AgentEventType =
    | 'think:start'
    | 'think:token'
    | 'think:complete'
    | 'tool:start'
    | 'tool:complete'
    | 'tool:error'
    | 'tool:retry'
    | 'collapse:start'
    | 'collapse:complete'
    | 'skill:start'
    | 'skill:complete'
    | 'budget:exhausted'
    | 'loop:detected'
    | 'task:complete';

export interface AgentEvent {
    type: AgentEventType;
    /** Node ID from nodes.ts (e.g. "think-0-3", "tool-1-7"). */
    nodeId: string;
    /** ID of the node that created this node. null = root. */
    parentId: string | null;
    /** ThinkNode depth within its own tree (0 = root of that tree). */
    nodeDepth: number;
    /** Skill nesting path. [] = top-level tree, ['code_runner'] = inside that skill. */
    skillStack: string[];
    /** Wall-clock ms since epoch. */
    timestamp: number;
    data: Record<string, unknown>;
}

export type AgentEventHandler = (event: AgentEvent) => void;

// ─── AgentObserver ────────────────────────────────────────────────────────────

/**
 * Opt-in pub/sub event bus for agent execution events.
 * Pass an instance to client.chat() via options.observer.
 *
 * All handler errors are caught internally — a buggy handler never
 * crashes the agent.
 */
export class AgentObserver {
    private readonly handlers: AgentEventHandler[] = [];

    /** Subscribe to all events. Returns an unsubscribe function. */
    public on(handler: AgentEventHandler): () => void {
        this.handlers.push(handler);
        return () => {
            const i = this.handlers.indexOf(handler);
            if (i >= 0) this.handlers.splice(i, 1);
        };
    }

    /** Emit an event to all subscribers. Called by internal processors only. */
    public emit(event: AgentEvent): void {
        for (const h of this.handlers) {
            try { h(event); } catch { /* never propagate handler errors into the agent */ }
        }
    }

    /** Create a root-level context (skillStack = []). */
    public rootContext(): ObserverContext {
        return new ObserverContext(this, []);
    }
}

// ─── ObserverContext ──────────────────────────────────────────────────────────

/**
 * Contextual wrapper that carries the current skillStack.
 * Internal processors receive this so they never have to manage skillStack.
 *
 * Passed as an optional second argument to ToolDefinition.handler so skill
 * handlers can create child contexts and pass them into their sub-executors.
 */
export class ObserverContext {
    constructor(
        public readonly observer: AgentObserver,
        public readonly skillStack: string[]
    ) {}

    public emit(
        type: AgentEventType,
        nodeId: string,
        nodeDepth: number,
        parentId: string | null,
        data: Record<string, unknown>
    ): void {
        this.observer.emit({
            type,
            nodeId,
            parentId,
            nodeDepth,
            skillStack: this.skillStack,
            timestamp: Date.now(),
            data,
        });
    }

    /** Returns a new context with skillName appended to the stack. */
    public childSkill(skillName: string): ObserverContext {
        return new ObserverContext(this.observer, [...this.skillStack, skillName]);
    }
}
