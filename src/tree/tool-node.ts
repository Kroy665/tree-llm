import type { ToolNodeData } from './nodes';
import type { ToolDefinition } from '../types';
import type { ObserverContext } from '../observer';

export interface RetryConfig {
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
}

/**
 * Executes a single tool call with exponential-backoff retry.
 *
 * Design contract:
 * - run() NEVER throws — all errors are recorded on the node
 * - run() returns the mutated ToolNodeData (result or error filled in)
 * - Retry events are reported via onRetry callback so the caller can
 *   yield them in the streaming pipeline at the right moment
 */
export class ToolNodeProcessor {
    constructor(
        private readonly node: ToolNodeData,
        private readonly tools: Map<string, ToolDefinition>,
        private readonly config: RetryConfig,
        private readonly observerCtx: ObserverContext | null = null
    ) {}

    public async run(
        onRetry?: (attempt: number, toolName: string, error: string, nextDelayMs: number) => void
    ): Promise<ToolNodeData> {
        const { retryMaxAttempts, retryBaseDelayMs } = this.config;
        this.node.status = 'running';

        while (this.node.attempts < retryMaxAttempts) {
            try {
                const tool = this.tools.get(this.node.toolName);
                if (!tool) {
                    throw new Error(`Tool "${this.node.toolName}" is not registered`);
                }

                const raw = await tool.handler(this.node.toolArgs, this.observerCtx, this.node.id);
                this.node.result = typeof raw === 'string' ? raw : JSON.stringify(raw);
                this.node.status = 'completed';
                return this.node;

            } catch (err) {
                this.node.attempts++;
                const errorMsg = err instanceof Error ? err.message : String(err);

                if (this.node.attempts < retryMaxAttempts) {
                    const delay = retryBaseDelayMs * Math.pow(2, this.node.attempts - 1);
                    onRetry?.(this.node.attempts, this.node.toolName, errorMsg, delay);
                    await sleep(delay);
                } else {
                    // Exhausted all attempts
                    this.node.error = `Tool "${this.node.toolName}" failed after ${this.node.attempts} attempt(s): ${errorMsg}`;
                    this.node.result = this.node.error;
                    this.node.status = 'failed';
                    return this.node;
                }
            }
        }

        // Should never reach here, but satisfy the compiler
        this.node.status = 'failed';
        return this.node;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
