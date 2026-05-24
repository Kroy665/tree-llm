import { Client, WEB_SAFE_TOOLS, registerWebSafeTools } from '../src/index';

describe('Client', () => {
    it('constructs with provider shorthand', () => {
        const client = new Client({ provider: 'ollama' });
        expect(client).toBeInstanceOf(Client);
    });

    it('registers and lists tools', () => {
        const client = new Client({ provider: 'ollama' });
        client.registerTool('test_tool', {
            definition: {
                type: 'function',
                function: { name: 'test_tool', description: 'test', parameters: { type: 'object', properties: {} } },
            },
            handler: async () => 'ok',
        });
        expect(client.getTools()).toHaveLength(4); // 3 visible builtins + test_tool
    });
});

describe('WEB_SAFE_TOOLS', () => {
    it('contains only safe tool names', () => {
        expect(WEB_SAFE_TOOLS).toEqual(['get_current_time', 'fetch_url', 'http_post']);
    });

    it('registerWebSafeTools registers exactly 3 tools', () => {
        const client = new Client({ provider: 'ollama' });
        registerWebSafeTools(client);
        expect(client.getTools()).toHaveLength(3);
    });
});
