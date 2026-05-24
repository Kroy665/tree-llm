import OpenAI from 'openai';
import { Logger } from './utils/logger';
import { TreeExecutor } from './tree/tree-executor';
import { configureE2B } from './tools/code';
import type {
    LLMProvider,
    ProviderConfig,
    ClientConfig,
    ChatChunk,
    ChatChunkType,
    ChatOptions,
    ConversationState,
    SkillDefinition,
    ToolDefinition,
} from './types';
import { builtinTools, INTERNAL_TOOLS } from './tools';

// ─── Provider Defaults ────────────────────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<LLMProvider, { baseUrl: string; model: string; timeout: number }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', timeout: 30_000 },
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash', timeout: 60_000 },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:3b', timeout: 180_000 },
};

export function createClientConfig(config: ProviderConfig): ClientConfig {
    const defaults = PROVIDER_DEFAULTS[config.provider];
    return {
        llmApiKey: config.llmApiKey ?? 'ollama',
        e2bApiKey: config.e2bApiKey,
        e2bTemplateId: config.e2bTemplateId,
        model: config.model ?? defaults.model,
        baseUrl: config.baseUrl ?? defaults.baseUrl,
        timeout: config.timeout ?? defaults.timeout,
        debug: config.debug ?? false,
    };
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class Client {
    private static readonly DEFAULT_TIMEOUT = 30000;
    private static readonly MAX_RECURSION_DEPTH = 5;

    private readonly logger: Logger;
    public ai: OpenAI;
    private readonly model: string;
    private readonly thinking_config?: ClientConfig['thinking_config'];
    private tools: Map<string, ToolDefinition> = new Map();
    private hiddenTools: Set<string> = new Set();
    private skills: Map<string, SkillDefinition> = new Map();
    private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    constructor(config: ClientConfig | ProviderConfig) {
        // Accept both ClientConfig and ProviderConfig (via provider shorthand)
        const resolved: ClientConfig =
            'provider' in config ? createClientConfig(config as ProviderConfig) : config as ClientConfig;

        this.logger = Logger.getInstance(resolved.debug ?? false);
        this.model = resolved.model;
        this.thinking_config = resolved.thinking_config;

        this.ai = new OpenAI({
            apiKey: resolved.llmApiKey,
            ...(resolved.baseUrl && { baseURL: resolved.baseUrl }),
            timeout: resolved.timeout ?? Client.DEFAULT_TIMEOUT,
        });

        if (resolved.e2bApiKey || resolved.e2bTemplateId) {
            configureE2B({ apiKey: resolved.e2bApiKey, templateId: resolved.e2bTemplateId });
        }

        for (const [name, tool] of Object.entries(builtinTools)) {
            this.tools.set(name, tool as ToolDefinition);
            if ((INTERNAL_TOOLS as string[]).includes(name)) {
                this.hiddenTools.add(name);
            }
        }

        this.addMessage(
            resolved.systemMessages ?? 'You are a helpful AI assistant.',
            'system'
        );
    }

    // ─── Tool Registration ────────────────────────────────────────────────────

    public registerTool(name: string, tool: ToolDefinition, options?: { hidden?: boolean }): void {
        this.tools.set(name, tool);
        if (options?.hidden) {
            this.hiddenTools.add(name);
        } else {
            this.hiddenTools.delete(name);
        }
        this.logger.debug(`Registered tool: ${name}${options?.hidden ? ' (hidden)' : ''}`);
    }

    /** Returns only tools visible to the top-level LLM (excludes hidden/internal tools). */
    public getTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return Array.from(this.tools.entries())
            .filter(([name]) => !this.hiddenTools.has(name))
            .map(([, t]) => t.definition);
    }

    /** Returns all tools including hidden ones — used by skill sub-agents. */
    public getAllTools(): Map<string, ToolDefinition> {
        return new Map(this.tools);
    }

    // ─── Skill Registration ───────────────────────────────────────────────────

    /**
     * Register a named skill as a sub-agent tool.
     *
     * The skill appears to the parent LLM as a single tool called `skill_<name>`.
     * Invoking it spawns a full sub-tree with the skill's system prompt and
     * (optionally) a restricted tool set, then returns the task_complete result
     * as a string to the parent tree.
     */
    public registerSkill(name: string, skill: SkillDefinition): void {
        this.skills.set(name, skill);

        const toolName = `skill_${name}`;
        const streamFn = this.chatCompletionStream.bind(this);

        this.registerTool(toolName, {
            definition: {
                type: 'function',
                function: {
                    name: toolName,
                    description: skill.description,
                    parameters: {
                        type: 'object',
                        properties: {
                            task: {
                                type: 'string',
                                description: 'The specific task or question for this skill to handle.',
                            },
                        },
                        required: ['task'],
                    },
                },
            },
            handler: async ({ task }: Record<string, unknown>) => {
                // Build the sub-agent's tool map from ALL tools (including hidden ones).
                // Skills are allowed to use internal tools; only the top-level LLM is restricted.
                const allTools = this.getAllTools();
                const subTools: Map<string, ToolDefinition> =
                    skill.tools
                        ? new Map([...allTools].filter(([k]) => skill.tools!.includes(k)))
                        : allTools;

                const systemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                    { role: 'system', content: skill.systemPrompt },
                ];

                const executor = new TreeExecutor(
                    streamFn,
                    subTools,
                    systemMessages,
                    skill.treeConfig ?? {}
                );

                let finalResult = '';
                for await (const chunk of executor.execute(task as string, {})) {
                    const { type, content } = chunk.choices[0].delta;
                    if (type === 'taskComplete' && content) {
                        finalResult = content;
                    }
                }
                return finalResult || '(skill completed with no explicit result)';
            },
        });

        this.logger.debug(`Registered skill: ${name} → tool: ${toolName}`);
    }

    public getSkills(): Map<string, SkillDefinition> {
        return new Map(this.skills);
    }

    // ─── Streaming ───────────────────────────────────────────────────────────

    public async *chatCompletionStream(options: {
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
        tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
        toolChoice?: OpenAI.Chat.Completions.ChatCompletionCreateParams['tool_choice'];
        chatChunkType?: ChatChunkType;
        temperature?: number;
        reasoningEffort?: 'low' | 'medium' | 'high';
        thinking_config?: ClientConfig['thinking_config'];
    }): AsyncGenerator<ChatChunk> {
        const chunkType = options.chatChunkType ?? 'internal';

        const stream = await this.ai.chat.completions.create({
            model: this.model,
            messages: options.messages,
            ...(options.tools?.length && { tools: options.tools }),
            ...(options.toolChoice && { tool_choice: options.toolChoice }),
            ...(options.reasoningEffort && { reasoning_effort: options.reasoningEffort }),
            ...(options.thinking_config && {
                extra_body: { google: { thinking_config: options.thinking_config } },
            }),
            stream: true,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
        });

        for await (const chunk of stream) {
            yield {
                choices: [{
                    delta: {
                        content: chunk.choices[0]?.delta?.content ?? undefined,
                        tool_calls: chunk.choices[0]?.delta?.tool_calls as ChatChunk['choices'][0]['delta']['tool_calls'],
                        type: chunkType,
                    },
                }],
            };
        }
    }

    // ─── Main Chat Interface ──────────────────────────────────────────────────

    public async *chat(
        content: string,
        options: ChatOptions = {},
        history?: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    ): AsyncGenerator<ChatChunk> {
        if (history) this.messages = history;

        // Tree mode: opt-in via options.treeConfig
        if (options.treeConfig !== undefined) {
            const streamFn = this.chatCompletionStream.bind(this);
            // Pass only visible (non-hidden) tools to the top-level executor.
            // Hidden tools remain accessible to skill sub-agents via getAllTools().
            const visibleTools = new Map(
                [...this.tools.entries()].filter(([name]) => !this.hiddenTools.has(name))
            );
            const executor = new TreeExecutor(
                streamFn,
                visibleTools,
                this.messages.filter(m => m.role === 'system'),
                options.treeConfig
            );
            yield* executor.execute(content, options);
            return;
        }

        // Linear mode (unchanged)
        yield* this.chatInternal(
            content,
            0,
            options.maxDepth ?? Client.MAX_RECURSION_DEPTH,
            options.autoSummarize ?? false
        );
    }

    // ─── Internal Chat Loop ───────────────────────────────────────────────────

    private async *chatInternal(
        content: string,
        depth: number,
        maxDepth: number,
        autoSummarize: boolean
    ): AsyncGenerator<ChatChunk> {
        if (depth >= maxDepth) {
            yield* this.handleMaxDepthReached(content, maxDepth);
            return;
        }

        if (content) this.addMessage(content, 'user');

        let assistantText = '';
        const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();
        const toolDefs = this.getTools();

        for await (const chunk of this.chatCompletionStream({
            messages: this.messages,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            thinking_config: this.thinking_config,
            chatChunkType: 'internal',
        })) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
                assistantText += delta.content;
                yield chunk;
            }

            // Accumulate fragmented tool calls across stream events
            if (delta?.tool_calls?.length) {
                for (const tc of delta.tool_calls as any[]) {
                    const idx: number = tc.index ?? 0;
                    if (!pendingCalls.has(idx)) {
                        pendingCalls.set(idx, { id: tc.id ?? '', name: '', arguments: '' });
                    }
                    const acc = pendingCalls.get(idx)!;
                    if (tc.function?.name) acc.name += tc.function.name;
                    if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                }
            }
        }

        // Build the tool_calls array for the assistant message
        const toolCallsArray = [...pendingCalls.values()].map((tc, i) => ({
            id: tc.id || `call_${i}`,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
        }));

        if (assistantText || toolCallsArray.length > 0) {
            this.messages.push({
                role: 'assistant',
                content: assistantText || undefined,
                ...(toolCallsArray.length > 0 && { tool_calls: toolCallsArray }),
            });
        }

        // Execute tool calls then recurse for follow-up
        if (pendingCalls.size > 0) {
            for (const [i, tc] of pendingCalls) {
                // Emit pre-execution chunk
                yield {
                    choices: [{
                        delta: {
                            content: JSON.stringify(
                                { tool: tc.name, args: this.tryParse(tc.arguments), executed: false },
                                null, 2
                            ),
                            tool_calls: [{ function: { name: tc.name, arguments: tc.arguments } }],
                            type: 'toolCall',
                        },
                    }],
                };

                const callId = toolCallsArray[i]?.id ?? `call_${i}`;
                yield* this.runTool(tc.name, tc.arguments, callId);
            }

            yield* this.chatInternal('', depth + 1, maxDepth, true);
            return;
        }

        // No tool calls — check if conversation should continue
        const evaluation = await this.shouldContinueConversation();
        if (evaluation.continue && evaluation.nextMessage) {
            yield {
                choices: [{
                    delta: { content: evaluation.nextMessage, type: 'shouldContinue' },
                }],
            };
            yield* this.chatInternal(evaluation.nextMessage, depth + 1, maxDepth, autoSummarize);
        } else if (autoSummarize) {
            yield* this.generateConversationSummary();
        }
    }

    // ─── Tool Execution ───────────────────────────────────────────────────────

    private async *runTool(
        name: string,
        argsStr: string,
        callId: string
    ): AsyncGenerator<ChatChunk> {
        const args = this.tryParse(argsStr);
        try {
            const tool = this.tools.get(name);
            if (!tool) throw new Error(`Tool "${name}" not registered`);

            const result = await tool.handler(args);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

            this.messages.push({ role: 'tool', tool_call_id: callId, content: resultStr });

            yield {
                choices: [{
                    delta: {
                        content: JSON.stringify({ tool: name, args, result, executed: true }, null, 2),
                        tool_calls: [{ function: { name, arguments: argsStr } }],
                        type: 'toolCall',
                    },
                }],
            };
        } catch (error) {
            const errorMsg = `Tool "${name}" failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
            this.messages.push({ role: 'tool', tool_call_id: callId, content: errorMsg });

            yield {
                choices: [{
                    delta: {
                        content: errorMsg,
                        tool_calls: [{ function: { name, arguments: argsStr } }],
                        type: 'toolCall',
                    },
                }],
            };
        }
    }

    // ─── Continuation Check ───────────────────────────────────────────────────

    private async shouldContinueConversation(): Promise<{
        taskStatus: string;
        continue: boolean;
        nextMessage?: string;
        reasoning?: string;
    }> {
        const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [{
            type: 'function',
            function: {
                name: 'evaluate_conversation_status',
                description: 'Decide whether the conversation needs to continue to fulfil the user\'s request.',
                parameters: {
                    type: 'object',
                    properties: {
                        taskStatus: {
                            type: 'string',
                            enum: ['completed', 'partially_completed', 'not_started', 'waiting_for_user'],
                        },
                        continue: {
                            type: 'boolean',
                            description:
                                'True ONLY if there is a clear unmet request or incomplete deliverable. ' +
                                'False for greetings, acknowledgments, completed tasks, or waiting_for_user.',
                        },
                        nextMessage: {
                            type: 'string',
                            description: 'Concrete next action if continue=true. Empty otherwise.',
                        },
                        reasoning: { type: 'string' },
                    },
                    required: ['taskStatus', 'continue', 'reasoning'],
                },
            },
        }];

        const evalPrompt =
            'Evaluate whether the conversation needs to continue to fulfil the user\'s request. ' +
            'Set continue=true ONLY if there is a clear unmet request or an incomplete deliverable. ' +
            'Set continue=false for greetings, acknowledgments, completed tasks, or when waiting for the user.';

        let functionArgs = '';
        try {
            for await (const chunk of this.chatCompletionStream({
                messages: [...this.messages, { role: 'user', content: evalPrompt }],
                tools,
                toolChoice: { type: 'function', function: { name: 'evaluate_conversation_status' } },
                chatChunkType: 'shouldContinue',
                temperature: 0.1,
            })) {
                const tc = (chunk.choices[0]?.delta?.tool_calls as any)?.[0];
                if (tc?.function?.name === 'evaluate_conversation_status') {
                    functionArgs += tc.function.arguments ?? '';
                }
            }

            if (functionArgs) {
                const parsed = JSON.parse(functionArgs);
                if (parsed.continue && !parsed.nextMessage) parsed.continue = false;
                this.logger.debug('Continuation evaluation:', parsed);
                return parsed;
            }
        } catch (error) {
            this.logger.error('Continuation evaluation failed:', error);
        }

        return { taskStatus: 'unknown', continue: false, reasoning: 'Evaluation failed' };
    }

    // ─── Summary ─────────────────────────────────────────────────────────────

    private async *generateConversationSummary(): AsyncGenerator<ChatChunk> {
        const prompt =
            'Provide a concise, direct response to what the user asked based on what was delivered. ' +
            'Do not use the word "summary".';
        yield* this.chatCompletionStream({
            messages: [...this.messages, { role: 'user', content: prompt }],
            chatChunkType: 'conversationSummary',
        });
    }

    private async *handleMaxDepthReached(content: string, maxDepth: number): AsyncGenerator<ChatChunk> {
        this.logger.warn(`Max depth (${maxDepth}) reached`);
        const msg =
            `Maximum conversation depth reached. Original request: "${content}". ` +
            'Provide a final response based on the conversation context.';
        yield* this.chatCompletionStream({
            messages: [...this.messages, { role: 'user', content: msg }],
            chatChunkType: 'maxDepthReached',
        });
    }

    // ─── Conversation Management ──────────────────────────────────────────────

    public clearConversation(): void {
        this.messages = this.messages.filter(m => m.role === 'system');
        this.logger.debug('Conversation cleared');
    }

    public getMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        return this.messages;
    }

    public getConversationState(): ConversationState {
        return {
            messageCount: this.messages.length,
            toolsAvailable: this.tools.size,
            lastActivity: new Date(),
        };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private addMessage(content: string, role: 'user' | 'assistant' | 'system'): void {
        this.messages.push({ role, content });
    }

    private tryParse(str: string): Record<string, unknown> {
        try { return JSON.parse(str || '{}'); } catch { return {}; }
    }
}
