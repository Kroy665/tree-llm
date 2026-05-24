import type OpenAI from 'openai';
import type { CollapseNodeData } from './nodes';

/**
 * Builds the context slice (messages array) for each ThinkNode.
 *
 * Key invariant: a ThinkNode's contextMessages is sealed at construction time
 * and never mutated.  Context never accumulates globally — each node sees only
 * what it needs.
 */
export class ContextManager {
    /**
     * Root ThinkNode context: system message + the user's initial message.
     */
    public buildRootContext(
        systemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        userMessage: string
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        return [
            ...systemMessages,
            { role: 'user', content: userMessage },
        ];
    }

    /**
     * Context for a non-root ThinkNode, built from the CollapseNode output.
     * The CollapseNode already ensured mergedMessages is within context bounds.
     *
     * Returns: system messages + collapse's merged messages.
     */
    public buildContinuationContext(
        systemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        collapse: CollapseNodeData
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        // mergedMessages already contain the user message + tool results (or compressed summary)
        // Prepend system messages to ensure they are always first.
        const nonSystem = collapse.mergedMessages.filter(m => m.role !== 'system');
        return [...systemMessages, ...nonSystem];
    }

    /**
     * Extract only the system messages from a context slice.
     */
    public extractSystemMessages(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        return messages.filter(m => m.role === 'system');
    }

    /**
     * Extract the original user message (first non-system message with role='user').
     */
    public extractOriginalUserMessage(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    ): string {
        const msg = messages.find(m => m.role === 'user');
        return typeof msg?.content === 'string' ? msg.content : '';
    }
}
