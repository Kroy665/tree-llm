import type OpenAI from 'openai';
import type { ToolDefinition } from '../client';
import type { ChatChunk, ChatOptions, TreeConfig, TreeStats } from '../types';
import { makeThinkNode } from './nodes';
import { ThinkNodeProcessor } from './think-node';
import { LoopDetector } from './loop-detector';
import { ContextManager } from './context-manager';
import type { StreamFn } from './collapse-node';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<TreeConfig> = {
    nodeBudget: 50,
    depthLimit: 50,
    collapseThreshold: 4000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 1000,
    maxRepeatsPerSignature: 2,
};

// ─── BudgetTracker ────────────────────────────────────────────────────────────

export class BudgetTracker {
    private nodesSpawned = 0;
    private maxDepthSeen = 0;
    public loopsDetected = 0;
    public retriesPerformed = 0;
    public compressionCount = 0;

    constructor(private readonly config: Required<TreeConfig>) {}

    public canSpawn(count: number): boolean {
        return this.nodesSpawned + count <= this.config.nodeBudget;
    }

    public trackSpawn(count: number): void {
        this.nodesSpawned += count;
    }

    public isDepthAllowed(depth: number): boolean {
        if (depth > this.maxDepthSeen) this.maxDepthSeen = depth;
        return depth <= this.config.depthLimit;
    }

    public getStats(totalNodes?: number): TreeStats {
        return {
            totalNodes: totalNodes ?? this.nodesSpawned,
            maxDepthReached: this.maxDepthSeen,
            loopsDetected: this.loopsDetected,
            retriesPerformed: this.retriesPerformed,
            compressionCount: this.compressionCount,
        };
    }
}

// ─── TreeExecutor ─────────────────────────────────────────────────────────────

/**
 * Entry point for tree-mode execution.
 * Called by Client.chat() when options.treeConfig is provided.
 *
 * Responsibilities:
 * - Resolve TreeConfig defaults
 * - Build root ThinkNode context
 * - Hand off to ThinkNodeProcessor
 * - Track and expose tree stats
 */
export class TreeExecutor {
    private readonly resolvedConfig: Required<TreeConfig>;
    private readonly budget: BudgetTracker;
    private readonly loopDetector: LoopDetector;
    private readonly contextManager: ContextManager;

    constructor(
        private readonly streamFn: StreamFn,
        private readonly tools: Map<string, ToolDefinition>,
        private readonly systemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        treeConfig: TreeConfig
    ) {
        this.resolvedConfig = { ...DEFAULTS, ...treeConfig };
        this.budget = new BudgetTracker(this.resolvedConfig);
        this.loopDetector = new LoopDetector(this.resolvedConfig.maxRepeatsPerSignature);
        this.contextManager = new ContextManager();
    }

    public async *execute(
        userMessage: string,
        _options: ChatOptions
    ): AsyncGenerator<ChatChunk> {
        const rootContext = this.contextManager.buildRootContext(
            this.systemMessages,
            userMessage
        );

        const rootNode = makeThinkNode(0, rootContext, new Map<string, number>());
        this.budget.trackSpawn(1);

        yield* new ThinkNodeProcessor(
            rootNode,
            this.streamFn,
            this.tools,
            this.loopDetector,
            this.contextManager,
            this.budget,
            this.resolvedConfig
        ).run();
    }

    public getStats(): TreeStats {
        return this.budget.getStats();
    }
}
