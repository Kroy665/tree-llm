import type { ToolDefinition } from '../client';

export const get_current_time: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'get_current_time',
            description: 'Get the current date and time in ISO 8601 format (UTC). To convert to a specific timezone, use the timezone parameter.',
            parameters: {
                type: 'object',
                properties: {
                    timezone: {
                        type: 'string',
                        description: 'IANA timezone name e.g. "Asia/Kolkata", "America/New_York", "Europe/London". Defaults to UTC.',
                    },
                },
            },
        },
    },
    handler: async ({ timezone }: Record<string, unknown>) => {
        const now = new Date();
        if (timezone && typeof timezone === 'string') {
            try {
                return {
                    iso: now.toISOString(),
                    local: now.toLocaleString('en-US', { timeZone: timezone, hour12: false }),
                    timezone,
                };
            } catch {
                return { error: `Unknown timezone: ${timezone}`, iso: now.toISOString() };
            }
        }
        return { iso: now.toISOString(), timezone: 'UTC' };
    },
};
