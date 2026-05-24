import type OpenAI from 'openai';
import type {
    ThinkNodeData,
    AccumulatedToolCall,
    ToolResult,
} from './nodes';
import { makeToolNode, makeCollapseNode, makeThinkNode } from './nodes';
import { ToolNodeProcessor, type RetryConfig } from './tool-node';
import { CollapseNodeProcessor, type StreamFn } from './collapse-node';
import { LoopDetector } from './loop-detector';
import { ContextManager } from './context-manager';
import { TASK_COMPLETE_TOOL_NAME, taskCompleteTool } from './task-complete';
import type { ToolDefinition } from '../types';
import type { ChatChunk, TreeConfig } from '../types';
import type { BudgetTracker } from './tree-executor';

/**
 * Executes a single ThinkNode: streams the LLM, handles tool calls in
 * parallel, collapses results, and recurses to the next ThinkNode.
 *
 * The tree expands here (tool calls → parallel ToolNodes) and collapses
 * here too (CollapseNode merges siblings → child ThinkNode).
 */
export class ThinkNodeProcessor {
    private readonly retryConfig: RetryConfig;
    private readonly collapseThreshold: number;

    constructor(
        private readonly node: ThinkNodeData,
        private readonly streamFn: StreamFn,
        private readonly tools: Map<string, ToolDefinition>,
        private readonly loopDetector: LoopDetector,
        private readonly contextManager: ContextManager,
        private readonly budget: BudgetTracker,
        private readonly config: Required<TreeConfig>
    ) {
        this.retryConfig = {
            retryMaxAttempts: config.retryMaxAttempts,
            retryBaseDelayMs: config.retryBaseDelayMs,
        };
        this.collapseThreshold = config.collapseThreshold;
    }

    public async *run(): AsyncGenerator<ChatChunk> {
        this.node.status = 'running';

        // ── 1. Stream LLM ─────────────────────────────────────────────────────
        const pendingCalls = new Map<number, AccumulatedToolCall>();
        let assistantText = '';

        const userTools = Array.from(this.tools.values()).map(t => t.definition);
        const allTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
            taskCompleteTool,
            ...userTools,
        ];

        for await (const chunk of this.streamFn({
            messages: this.node.contextMessages,
            tools: allTools,
            chatChunkType: 'internal',
        })) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
                assistantText += delta.content;
                yield chunk;
            }

            // Accumulate tool call fragments across stream events.
            // OpenAI always provides tc.index to identify which parallel call a
            // fragment belongs to.  Gemini sends ALL tool calls in one chunk with
            // no index field — use the current map size as an offset so each new
            // call gets its own slot regardless of whether index is present.
            if (delta?.tool_calls?.length) {
                const tcs = delta.tool_calls as any[];
                const baseIdx = pendingCalls.size;
                for (let i = 0; i < tcs.length; i++) {
                    const tc = tcs[i];
                    const idx: number = tc.index ?? (baseIdx + i);
                    if (!pendingCalls.has(idx)) {
                        pendingCalls.set(idx, { index: idx, id: tc.id ?? '', name: '', arguments: '' });
                    }
                    const acc = pendingCalls.get(idx)!;
                    if (tc.function?.name) acc.name += tc.function.name;
                    if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                    if (tc.id) acc.id = tc.id;
                    // Capture Gemini thought_signature (round-trip requirement)
                    const sig = tc.extra_content?.google?.thought_signature;
                    if (sig) acc.thoughtSignature = (acc.thoughtSignature ?? '') + sig;
                }
            }
        }

        this.node.assistantText = assistantText;
        this.node.toolCalls = [...pendingCalls.values()];

        // ── 2. Detect task_complete ───────────────────────────────────────────
        const completeCall = this.node.toolCalls.find(
            tc => tc.name === TASK_COMPLETE_TOOL_NAME
        );
        if (completeCall) {
            const args = tryParse(completeCall.arguments) as { result: string; summary?: string };
            this.node.taskCompleteArgs = args;
            this.node.status = 'completed';
            yield {
                choices: [{
                    delta: {
                        content: args.result,
                        type: 'taskComplete',
                    },
                }],
            };
            return; // unwinds tree via generator return
        }

        // ── 3. If no tool calls and no text, nothing to do ────────────────────
        const userToolCalls = this.node.toolCalls.filter(
            tc => tc.name !== TASK_COMPLETE_TOOL_NAME
        );

        if (userToolCalls.length === 0) {
            // Pure text response — tree is done (no task_complete means the model
            // just answered directly; treat as implicitly complete)
            if (assistantText.trim()) {
                yield {
                    choices: [{
                        delta: { content: assistantText, type: 'taskComplete' },
                    }],
                };
            }
            this.node.status = 'completed';
            return;
        }

        // ── 4. Budget check ───────────────────────────────────────────────────
        if (!this.budget.isDepthAllowed(this.node.depth + 1)) {
            yield {
                choices: [{
                    delta: {
                        content: `[tree] Depth limit (${this.config.depthLimit}) reached. Stopping here.`,
                        type: 'budgetExhausted',
                    },
                }],
            };
            this.node.status = 'completed';
            return;
        }

        if (!this.budget.canSpawn(userToolCalls.length + 2)) { // tools + collapse + think
            yield {
                choices: [{
                    delta: {
                        content: `[tree] Node budget (${this.config.nodeBudget}) exhausted. Stopping here.`,
                        type: 'budgetExhausted',
                    },
                }],
            };
            this.node.status = 'completed';
            return;
        }

        // ── 5. Filter loop-detected tool calls ────────────────────────────────
        const filteredCalls: AccumulatedToolCall[] = [];
        for (const tc of userToolCalls) {
            const args = tryParse(tc.arguments);
            if (this.loopDetector.wouldLoop(this.node.pathSignatures, tc.name, args)) {
                yield {
                    choices: [{
                        delta: {
                            content: `[tree] Loop detected: ${tc.name}(${tc.arguments}) already in path — pruning branch`,
                            type: 'loopDetected',
                        },
                    }],
                };
            } else {
                filteredCalls.push(tc);
            }
        }

        if (filteredCalls.length === 0) {
            this.node.status = 'completed';
            return;
        }

        // ── 6. Emit pre-execution toolCall chunks ─────────────────────────────
        for (const tc of filteredCalls) {
            yield {
                choices: [{
                    delta: {
                        content: JSON.stringify(
                            { tool: tc.name, args: tryParse(tc.arguments), executed: false },
                            null, 2
                        ),
                        tool_calls: [{ function: { name: tc.name, arguments: tc.arguments } }],
                        type: 'toolCall',
                    },
                }],
            };
        }

        // ── 7. Spawn ToolNodes and execute in parallel ────────────────────────
        // Build a callId → thoughtSignature lookup for round-tripping provider tokens.
        const thoughtSignatureByCallId = new Map<string, string>();
        for (const tc of filteredCalls) {
            if (tc.thoughtSignature) thoughtSignatureByCallId.set(tc.id, tc.thoughtSignature);
        }

        const toolNodes = filteredCalls.map((tc, i) =>
            makeToolNode(
                this.node.depth,
                tc.id || `call_${this.node.id}_${i}`,
                tc.name,
                tryParse(tc.arguments),
                tc.arguments
            )
        );
        this.budget.trackSpawn(toolNodes.length);

        const retryEvents: Array<{ attempt: number; toolName: string; error: string }> = [];

        const settledResults = await Promise.allSettled(
            toolNodes.map(tn =>
                new ToolNodeProcessor(tn, this.tools, this.retryConfig).run(
                    (attempt, toolName, error) => retryEvents.push({ attempt, toolName, error })
                )
            )
        );

        // ── 8. Yield retry events, then post-execution chunks ─────────────────
        for (const evt of retryEvents) {
            yield {
                choices: [{
                    delta: {
                        content: JSON.stringify(evt),
                        type: 'toolRetry',
                    },
                }],
            };
        }

        const toolResults: ToolResult[] = [];
        for (const outcome of settledResults) {
            // ToolNodeProcessor.run() never rejects, but handle just in case
            const tn = outcome.status === 'fulfilled'
                ? outcome.value
                : toolNodes[settledResults.indexOf(outcome)];

            yield {
                choices: [{
                    delta: {
                        content: JSON.stringify(
                            { tool: tn.toolName, result: tn.result, success: tn.status === 'completed' },
                            null, 2
                        ),
                        tool_calls: [{ function: { name: tn.toolName, arguments: tn.rawArgsStr } }],
                        type: 'toolCall',
                    },
                }],
            };

            toolResults.push({
                callId: tn.callId,
                toolName: tn.toolName,
                args: tn.toolArgs,
                result: tn.result ?? tn.error ?? '',
                success: tn.status === 'completed',
                thoughtSignature: thoughtSignatureByCallId.get(tn.callId),
            });
        }

        // ── 9. CollapseNode ───────────────────────────────────────────────────
        const collapseNode = makeCollapseNode(
            this.node.depth,
            this.node.contextMessages,
            this.node.assistantText,
            toolResults
        );
        this.budget.trackSpawn(1);

        let mergedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        const collapseGen = new CollapseNodeProcessor(
            collapseNode,
            this.streamFn,
            this.collapseThreshold
        ).run();

        let collapseStep = await collapseGen.next();
        while (!collapseStep.done) {
            yield collapseStep.value;
            collapseStep = await collapseGen.next();
        }
        mergedMessages = collapseStep.value;

        // ── 10. Build extended path signatures ────────────────────────────────
        let extendedSignatures = this.node.pathSignatures;
        for (const tn of toolNodes) {
            extendedSignatures = this.loopDetector.extendPath(
                extendedSignatures,
                tn.toolName,
                tn.toolArgs
            );
        }

        // ── 11. Spawn child ThinkNode and recurse ─────────────────────────────
        const childContext = this.contextManager.buildContinuationContext(
            this.contextManager.extractSystemMessages(this.node.contextMessages),
            collapseNode
        );
        const childNode = makeThinkNode(
            this.node.depth + 1,
            childContext,
            extendedSignatures
        );
        this.budget.trackSpawn(1);

        this.node.status = 'completed';
        yield* new ThinkNodeProcessor(
            childNode,
            this.streamFn,
            this.tools,
            this.loopDetector,
            this.contextManager,
            this.budget,
            this.config
        ).run();
    }
}

function tryParse(str: string): Record<string, unknown> {
    try { return JSON.parse(str || '{}'); } catch { return {}; }
}
