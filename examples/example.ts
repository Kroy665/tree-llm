import { Client, registerBuiltinTools } from 'tree-llm';

const now = new Date();
const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

// const client = new Client({
//     provider: 'ollama',
//     model: 'llama3.2:3b'
// });

const client = new Client({
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    llmApiKey: process.env.GEMINI_API_KEY!,
    systemMessages: `You are a helpful autonomous agent. Today is ${dateStr}, ${timeStr} IST. The current year is 2026. Use this date whenever you need the current date — do NOT call get_current_time under any circumstance.`,
});

// Register all built-in tools except get_current_time — date is already in the system prompt,
// and offering this tool causes the model to call it repeatedly, triggering loop detection.
registerBuiltinTools(client, [
    'read_file', 'write_file', 'list_files', 'delete_file', 'file_exists',
    'fetch_url', 'http_post',
    'run_command',
    'run_python', 'run_javascript', 'run_typescript', 'get_sandbox_url', 'run_sandbox_command',
]);

// ── Register skills ────────────────────────────────────────────────────────────

client.registerSkill('code_runner', {
    description:
        'Executes Python or JavaScript code in a secure E2B sandbox and returns the output. ' +
        'Use for computations, data processing, or running scripts.',
    systemPrompt:
        'You are a code execution expert. When given a task, write clean and correct code, ' +
        'run it using the available sandbox tools, and return the exact output. ' +
        'Prefer run_python for data tasks, run_javascript for web/Node tasks.',
    tools: ['run_python', 'run_javascript', 'run_typescript', 'run_sandbox_command', 'get_sandbox_url'],
});

client.registerSkill('web_researcher', {
    description:
        'Fetches and summarises content from URLs. ' +
        'Use when you need to retrieve information from the web.',
    systemPrompt:
        'You are a web research assistant. Fetch the given URLs, extract the key information, ' +
        'and return a concise factual summary. Preserve numbers, names, and dates exactly.',
    tools: ['fetch_url', 'http_post'],
});

client.registerSkill('file_manager', {
    description:
        'Reads, writes, lists, and manages files on the local filesystem.',
    systemPrompt:
        'You are a file system assistant. Perform the requested file operations accurately ' +
        'and report exactly what was read or written.',
    tools: ['read_file', 'write_file', 'list_files', 'delete_file', 'file_exists'],
});

// ── Task ───────────────────────────────────────────────────────────────────────

const TASK = `
Budget: ₹60,000 INR. Find the best smartphones launched in India in the last 3 months (Feb–May 2026).

Step 1: Use skill_code_runner to run Python that fetches https://www.91mobiles.com/list-of-phones/best-mobiles-under-60000-in-india
with browser-like headers (User-Agent, Accept, Accept-Language) using urllib.request, then parse the HTML for phone names, prices, and launch dates.
If that URL fails, try https://www.gadgets360.com/mobiles/best-mobile-phones-under-60000 with the same approach.

Step 2: From the data you collected, identify the TOP 3 phones that:
- Were launched between Feb 2026 and May 2026
- Are priced under ₹60,000

Step 3: Call task_complete with a markdown table using exactly this format:
| # | Phone | Price (₹) | Key Specs | Why Buy |
|---|-------|-----------|-----------|---------|
| 1 | ... | ... | ... | ... |

If you already have enough data to fill the table, do NOT fetch more URLs — just call task_complete immediately.
`.trim();


const main = async () => {
    console.log('=== Tree mode (complex task) ===\n');
    for await (const chunk of client.chat(TASK, { treeConfig: { nodeBudget: 100, depthLimit: 20 } })) {
        const { type, content } = chunk.choices[0].delta;
        if (!content) continue;
        if (type === 'internal') {
            process.stdout.write(content);
        } else if (type === 'toolCall') {
            // Show just the tool name on one line to reduce noise
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
