import type OpenAI from 'openai';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'pruned';
export type NodeKind = 'think' | 'tool' | 'collapse';

export interface BaseNode {
    id: string;
    kind: NodeKind;
    depth: number;
    status: NodeStatus;
    createdAt: number;
}

export interface AccumulatedToolCall {
    index: number;
    id: string;
    name: string;
    arguments: string;
    /** Provider-specific opaque token (e.g. Gemini thought_signature). Round-tripped as-is. */
    thoughtSignature?: string;
}

export interface TaskCompleteArgs {
    result: string;
    summary?: string;
}

export interface ToolResult {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
    /** Provider-specific opaque token (e.g. Gemini thought_signature). Round-tripped as-is. */
    thoughtSignature?: string;
}

export interface ThinkNodeData extends BaseNode {
    kind: 'think';
    contextMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    pathSignatures: Map<string, number>;
    assistantText: string;
    toolCalls: AccumulatedToolCall[];
    taskCompleteArgs: TaskCompleteArgs | null;
}

export interface ToolNodeData extends BaseNode {
    kind: 'tool';
    callId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    rawArgsStr: string;
    attempts: number;
    result: string | null;
    error: string | null;
}

export interface CollapseNodeData extends BaseNode {
    kind: 'collapse';
    parentContextMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    assistantText: string;      // text the model produced before the tool calls (may be empty)
    toolResults: ToolResult[];
    compressed: boolean;
    mergedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

// ─── Factories ────────────────────────────────────────────────────────────────

let _nodeCounter = 0;

export function makeThinkNode(
    depth: number,
    contextMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    pathSignatures: Map<string, number>
): ThinkNodeData {
    return {
        id: `think-${depth}-${_nodeCounter++}`,
        kind: 'think',
        depth,
        status: 'pending',
        createdAt: Date.now(),
        contextMessages,
        pathSignatures,
        assistantText: '',
        toolCalls: [],
        taskCompleteArgs: null,
    };
}

export function makeToolNode(
    depth: number,
    callId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    rawArgsStr: string
): ToolNodeData {
    return {
        id: `tool-${depth}-${_nodeCounter++}`,
        kind: 'tool',
        depth,
        status: 'pending',
        createdAt: Date.now(),
        callId,
        toolName,
        toolArgs,
        rawArgsStr,
        attempts: 0,
        result: null,
        error: null,
    };
}

export function makeCollapseNode(
    depth: number,
    parentContextMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    assistantText: string,
    toolResults: ToolResult[]
): CollapseNodeData {
    return {
        id: `collapse-${depth}-${_nodeCounter++}`,
        kind: 'collapse',
        depth,
        status: 'pending',
        createdAt: Date.now(),
        parentContextMessages,
        assistantText,
        toolResults,
        compressed: false,
        mergedMessages: [],
    };
}
