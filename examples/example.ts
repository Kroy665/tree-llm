import { Client, registerBuiltinSkills, registerBuiltinTools, createInspector } from 'tree-llm';
import { readFileSync } from 'fs';
import 'dotenv/config';
import webSearchTool from './webSearchTool';

const now = new Date();
const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

const client = new Client({
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    llmApiKey: process.env.GEMINI_API_KEY!,
    e2bApiKey: process.env.E2B_API_KEY!,
    e2bSecure: true,  // required for sandbox_download_url
    systemMessages: `You are a helpful autonomous agent. Today is ${dateStr}, ${timeStr} IST. The current year is 2026. Use this date whenever you need the current date — do NOT call get_current_time under any circumstance.`,
});

// ── Register built-in tools ───────────────────────────────────────────────────
registerBuiltinTools(client);

// ── Register built-in skills ───────────────────────────────────────────────────
registerBuiltinSkills(client);

// ── Custom tool ────────────────────────────────────────────────────────────────

client.registerTool('get_weather', {
    definition: {
        type: 'function',
        function: {
            name: 'get_weather',
            description: 'Get the current weather for a city.',
            parameters: {
                type: 'object',
                properties: {
                    city: { type: 'string', description: 'City name, e.g. "Mumbai"' },
                },
                required: ['city'],
            },
        },
    },
    handler: async ({ city }) => {

        // call your real weather API here
        return { city, temperature: '32°C', condition: 'Sunny' };
    },
});

client.registerTool('web_search', webSearchTool);




// ── Register custom skills ─────────────────────────────────────────────────────

const docxSkillContent = readFileSync('./docx_skill.md', 'utf-8');

client.registerSkill('docx_skill', {
    description: 'This skill is used to create a DOCX document. Use this skill when the user asks to create a DOCX document.',
    systemPrompt: docxSkillContent,
    tools: [
        'fetch_url', 'http_post',
        'run_python', 'run_javascript', 'run_typescript', 'get_sandbox_url', 'run_sandbox_command',
        'sandbox_read_file', 'sandbox_write_file', 'sandbox_list_files',
        'sandbox_delete_file', 'sandbox_file_exists', 'sandbox_make_dir',
        'sandbox_download_url',
    ],
});

// ── Task ───────────────────────────────────────────────────────────────────────

const TASK = `
What's trending in AI this week? Search and summarise the top stories.
`.trim();

const inspector = createInspector({
    showTokens: true,
    maxArgChars: 120,
    maxResultChars: 200,
    output: process.stderr,
});

const main = async () => {
    process.stderr.write('=== tree-llm inspector ===\n\n');
    for await (const chunk of client.chat(TASK, {
        treeConfig: { nodeBudget: 100, depthLimit: 20 },
        observer: inspector,
    })) {
        const { type, content } = chunk.choices[0].delta;
        if (type === 'taskComplete' && content) {
            process.stdout.write('\n=== FINAL RESULT ===\n' + content + '\n');
        }
    }
};

main().catch(console.error);
