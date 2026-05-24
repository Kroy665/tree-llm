import { Client, registerBuiltinSkills, registerBuiltinTools } from 'tree-llm';
import { readFileSync } from 'fs';
import 'dotenv/config';

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

// ── Register custom skills ─────────────────────────────────────────────────────

const docxSkillContent = readFileSync('./docx_skill.md', 'utf-8');

client.registerSkill('docx_skill', {
    description: 'This skill is used to create a DOCX document.',
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
Create a DOCX file with the following content:
Title: "My Portfolio"

Name: Koushik Roy, 32, M.Sc Math, B.Sc Math
Experience: 10 years
Soft skills: Communication, Teamwork, Leadership
Technical skills: Python, JavaScript, TypeScript, Node.js, React, Angular, Vue.js, Express, NestJS, FastAPI, Django, Flask, PostgreSQL, MySQL, MongoDB, Redis, Docker, Kubernetes, AWS, GCP, Azure, Git, GitHub, GitLab, Bitbucket, Jenkins, CircleCI, TravisCI, Docker, Kubernetes, AWS, GCP, Azure, Git, GitHub, GitLab, Bitbucket, Jenkins, CircleCI, TravisCI

After creating the file, use sandbox_download_url to get a download link for the file and include it in your final response.
`.trim();

const main = async () => {
    console.log('=== Tree mode (complex task) ===\n');
    for await (const chunk of client.chat(TASK, { treeConfig: { nodeBudget: 100, depthLimit: 20 } })) {
        const { type, content } = chunk.choices[0].delta;
        if (!content) continue;
        if (type === 'internal') {
            process.stdout.write(content);
        } else if (type === 'toolCall') {
            try {
                const obj = JSON.parse(content);
                const tag = obj.executed === false ? '→ calling' : obj.executed === true ? '← result' : (obj.success !== undefined ? (obj.success ? '✓' : '✗') : '?');
                console.log(`\n[tool ${tag}] ${obj.tool}`);
            } catch { /* not JSON */ }
        } else if (type === 'collapse') {
            console.log(`\n[collapse]: ${content}`);
        } else if (type === 'taskComplete') {
            console.log('\n\n=== FINAL RESULT ===\n');
            console.log(content);
        } else {
            console.log(`\n[${type}] ${content}`);
        }
    }
};

main().catch(console.error);
