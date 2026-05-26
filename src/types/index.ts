import type OpenAI from 'openai';
import type { ObserverContext } from '../observer';

export interface ToolDefinition {
    definition: OpenAI.Chat.Completions.ChatCompletionTool;
    handler: (args: Record<string, unknown>, observerCtx?: ObserverContext | null, parentNodeId?: string | null) => Promise<unknown>;
    /** Per-tool repeat limit. Overrides TreeConfig.maxRepeatsPerSignature for this tool. */
    maxRepeats?: number;
}

export type LLMProvider = 'openai' | 'gemini' | 'ollama';

export interface ProviderConfig {
    provider: LLMProvider;
    llmApiKey?: string;
    e2bApiKey?: string;
    e2bTemplateId?: string;
    e2bSecure?: boolean;
    model?: string;
    baseUrl?: string;
    timeout?: number;
    debug?: boolean;
}

export interface ClientConfig {
    llmApiKey: string;
    e2bApiKey?: string;
    e2bTemplateId?: string;
    e2bSecure?: boolean;
    model: string;
    baseUrl?: string;
    timeout?: number;
    debug?: boolean;
    systemMessages?: string;
    thinking_config?: {
        thinking_budget: number;
        include_thoughts: boolean;
    };
}

export type ChatChunkType =
    | 'internal'           // streaming LLM text tokens
    | 'toolCall'           // tool pre/post execution
    | 'toolRetry'          // ToolNode retrying after failure
    | 'collapse'           // CollapseNode merging results
    | 'taskComplete'       // task_complete called — terminal
    | 'budgetExhausted'    // nodeBudget or depthLimit hit
    | 'loopDetected'       // loop signature matched, branch pruned
    | 'maxDepthReached'    // legacy linear path
    | 'shouldContinue'     // legacy linear path
    | 'conversationSummary'; // legacy linear path

export interface ChatChunk {
    choices: Array<{
        delta: {
            content?: string;
            tool_calls?: Array<{
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
            type: ChatChunkType;
        };
    }>;
}

export interface TreeConfig {
    nodeBudget?: number;              // max total nodes spawned (default: 50)
    depthLimit?: number;              // max ThinkNode depth (default: 10)
    collapseThreshold?: number;       // chars before compression kicks in (default: 4000)
    retryMaxAttempts?: number;        // ToolNode max retries (default: 3)
    retryBaseDelayMs?: number;        // first retry delay in ms (default: 1000)
    maxRepeatsPerSignature?: number;  // how many times the same (tool,args) can appear in one path (default: 2)
}

export interface ToolExecutionResult {
    success: boolean;
    result?: unknown;
    error?: string;
    toolName: string;
    arguments: Record<string, unknown>;
    timestamp: Date;
}

export interface TreeStats {
    totalNodes: number;
    maxDepthReached: number;
    loopsDetected: number;
    retriesPerformed: number;
    compressionCount: number;
}

export interface ConversationState {
    messageCount: number;
    toolsAvailable: number;
    lastActivity: Date;
    treeStats?: TreeStats;
}

/**
 * A Skill is a named, reusable sub-agent configuration.
 *
 * When registered on a Client, it is exposed to the parent LLM as a single
 * tool called `skill_<name>`. Calling it spawns a full sub-tree with its own
 * system prompt and (optionally) a restricted tool set, then returns the
 * task_complete result as a string to the parent tree.
 */
export interface SkillDefinition {
    /** One-sentence description shown to the parent LLM as the tool's description. */
    description: string;
    /** System prompt injected into the sub-agent's context. */
    systemPrompt: string;
    /**
     * Whitelist of tool names the sub-agent may use.
     * Undefined → inherits all tools registered on the client (including other skills).
     */
    tools?: string[];
    /** Tree config overrides for this skill's sub-tree. */
    treeConfig?: TreeConfig;
}

export interface ChatOptions {
    maxDepth?: number;
    autoSummarize?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high';
    treeConfig?: TreeConfig;    // presence opts into tree execution
    observer?: import('../observer').AgentObserver;  // opt-in real-time observability
}
