import type { ToolDefinition } from '../types';

export const fetch_url: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch the content of a URL via HTTP GET. Returns status, headers, and body text. Useful for reading web pages, APIs, or any HTTP resource.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to fetch.' },
                    headers: {
                        type: 'object',
                        description: 'Optional HTTP request headers as key-value pairs (e.g. {"Authorization": "Bearer token"}).',
                    },
                    max_bytes: {
                        type: 'number',
                        description: 'Truncate response body to this many bytes. Default: 20000.',
                    },
                },
                required: ['url'],
            },
        },
    },
    handler: async ({ url, headers = {}, max_bytes = 20000 }: Record<string, unknown>) => {
        const res = await fetch(url as string, {
            method: 'GET',
            headers: headers as Record<string, string>,
            signal: AbortSignal.timeout(15_000),
        });

        const contentType = res.headers.get('content-type') ?? '';
        let body: string;

        if (contentType.includes('application/json')) {
            const json = await res.json();
            body = JSON.stringify(json, null, 2);
        } else {
            const text = await res.text();
            body = text.slice(0, max_bytes as number);
        }

        return {
            url,
            status: res.status,
            ok: res.ok,
            contentType,
            body,
            truncated: typeof body === 'string' && body.length >= (max_bytes as number),
        };
    },
};

export const http_post: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'http_post',
            description: 'Send an HTTP POST request with a JSON body and return the response.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to POST to.' },
                    body: { type: 'object', description: 'JSON body to send.' },
                    headers: {
                        type: 'object',
                        description: 'Optional HTTP request headers (e.g. {"Content-Type": "application/json"}).',
                    },
                },
                required: ['url', 'body'],
            },
        },
    },
    handler: async ({ url, body, headers = {} }: Record<string, unknown>) => {
        const res = await fetch(url as string, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(headers as Record<string, string>),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
        });

        let responseBody: unknown;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
            responseBody = await res.json();
        } else {
            responseBody = await res.text();
        }

        return { url, status: res.status, ok: res.ok, body: responseBody };
    },
};
