import type OpenAI from 'openai';

export const TASK_COMPLETE_TOOL_NAME = 'task_complete';

/**
 * Built-in tool always injected as the first tool in every ThinkNode.
 * When the LLM calls this, the tree terminates and delivers the final answer —
 * no separate "should I continue?" LLM call needed.
 */
export const taskCompleteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
    type: 'function',
    function: {
        name: TASK_COMPLETE_TOOL_NAME,
        description:
            'Call this tool when you have fully satisfied the user\'s request and no further ' +
            'actions are needed. This terminates the session and delivers your final answer.',
        parameters: {
            type: 'object',
            properties: {
                result: {
                    type: 'string',
                    description: 'The complete final answer or deliverable for the user.',
                },
                summary: {
                    type: 'string',
                    description: 'Optional one-sentence summary of what was accomplished.',
                },
            },
            required: ['result'],
        },
    },
};
