import type OpenAI from 'openai';
import type { CollapseNodeData } from './nodes';
import type { ChatChunk } from '../types';

export type StreamFn = (options: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    toolChoice?: OpenAI.Chat.Completions.ChatCompletionCreateParams['tool_choice'];
    chatChunkType?: import('../types').ChatChunkType;
    temperature?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    thinking_config?: {
        thinking_budget: number;
        include_thoughts: boolean;
    };
}) => AsyncGenerator<ChatChunk>;

/**
 * Merges all sibling ToolNode results into a single context slice for the
 * next ThinkNode.
 *
 * Below collapseThreshold  → appends raw tool messages to parent context.
 * Above collapseThreshold  → runs a mini LLM compression call; replaces the
 *   tool message history with a compact summary while always preserving the
 *   system message and original user message.
 */
export class CollapseNodeProcessor {
    constructor(
        private readonly node: CollapseNodeData,
        private readonly streamFn: StreamFn,
        private readonly collapseThreshold: number
    ) {}

    public async *run(): AsyncGenerator<ChatChunk, OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
        this.node.status = 'running';

        const totalChars = this.node.toolResults.reduce(
            (sum, r) => sum + r.result.length,
            0
        );

        // Build the assistant message that precedes tool-role messages.
        // Use empty string (not null, not omitted) — Gemini requires the field present.
        // Rebuild the assistant message.  When a provider (e.g. Gemini) attaches a
        // thought_signature to a tool call we must round-trip it back in the history
        // or subsequent requests will be rejected with INVALID_ARGUMENT.
        // Rebuild the assistant message.  When a provider (e.g. Gemini) attaches a
        // thought_signature to a tool call we must round-trip it back in the history
        // or subsequent requests will be rejected with INVALID_ARGUMENT.
        const assistantMsg = {
            role: 'assistant' as const,
            content: this.node.assistantText || '',
            tool_calls: this.node.toolResults.map(r => {
                const tc: any = {
                    id: r.callId,
                    type: 'function' as const,
                    function: { name: r.toolName, arguments: JSON.stringify(r.args) },
                };
                if (r.thoughtSignature) {
                    tc.extra_content = { google: { thought_signature: r.thoughtSignature } };
                }
                return tc;
            }),
        } as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam;

        const toolMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
            this.node.toolResults.map(r => ({
                role: 'tool' as const,
                tool_call_id: r.callId,
                content: r.result,
            }));

        if (totalChars <= this.collapseThreshold) {
            // No compression needed
            this.node.mergedMessages = [
                ...this.node.parentContextMessages,
                assistantMsg,
                ...toolMsgs,
            ];
            this.node.compressed = false;
            this.node.status = 'completed';

            yield {
                choices: [{
                    delta: {
                        content: `[collapse] merged ${this.node.toolResults.length} tool result(s) (${totalChars} chars, no compression)`,
                        type: 'collapse',
                    },
                }],
            };

            return this.node.mergedMessages;
        }

        // Above threshold — compress via LLM
        const compressionPrompt =
            'You are summarising tool execution results for an AI agent that needs to continue a task. ' +
            'Be dense and factual. Preserve ALL numbers, identifiers, file names, error messages, and ' +
            'concrete values. Format as a compact prose summary.\n\n' +
            'Tool results to summarise:\n' +
            JSON.stringify(
                this.node.toolResults.map(r => ({
                    tool: r.toolName,
                    args: r.args,
                    result: r.result,
                    success: r.success,
                })),
                null,
                2
            ) +
            '\n\nProduce a single compressed summary (max 500 words) that the agent can use to continue.';

        const systemMsgs = this.node.parentContextMessages.filter(m => m.role === 'system');
        const userMsg = this.node.parentContextMessages.find(m => m.role === 'user');

        let compressedText = '';
        for await (const chunk of this.streamFn({
            messages: [
                ...systemMsgs,
                { role: 'user', content: compressionPrompt },
            ],
            chatChunkType: 'collapse',
            temperature: 0.1,
        })) {
            const text = chunk.choices[0]?.delta?.content ?? '';
            if (text) compressedText += text;
            yield chunk;
        }

        this.node.mergedMessages = [
            ...systemMsgs,
            ...(userMsg ? [userMsg] : []),
            { role: 'assistant', content: compressedText },
        ];
        this.node.compressed = true;
        this.node.status = 'completed';

        return this.node.mergedMessages;
    }
}
