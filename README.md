# tree-llm

A TypeScript agent executor that runs LLM reasoning as a **tree** — branching on tool calls, compressing context at depth, detecting loops, and retrying failures — with a built-in E2B sandbox, streaming output, and a composable skill system.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Providers](#providers)
- [Execution Modes](#execution-modes)
  - [Tree Mode](#tree-mode)
  - [Linear Mode](#linear-mode)
- [Streaming Output](#streaming-output)
- [Built-in Tools](#built-in-tools)
- [Built-in Skills](#built-in-skills)
- [Custom Tools](#custom-tools)
- [Custom Skills](#custom-skills)
- [E2B Sandbox](#e2b-sandbox)
- [API Reference](#api-reference)
- [Development](#development)

---

## Installation

Install directly from GitHub (no npm publish needed):

```bash
npm install github:kroy665/tree-llm
```

Or pin to a specific commit or tag:

```bash
npm install github:kroy665/tree-llm#main
npm install github:kroy665/tree-llm#v1.0.0
```

The package compiles itself automatically after install (`prepare` script runs `tsc`), so the TypeScript source is built on the consumer's machine.

Requires Node.js >= 18.

---

## Quick Start

```typescript
import { Client, registerBuiltinTools, registerBuiltinSkills } from 'tree-llm';

const client = new Client({
    provider: 'openai',
    llmApiKey: process.env.OPENAI_API_KEY!,
    e2bApiKey: process.env.E2B_API_KEY!,
});

registerBuiltinTools(client);
registerBuiltinSkills(client);

for await (const chunk of client.chat('Analyse the dataset at /data/sales.csv and plot a bar chart', {
    treeConfig: { nodeBudget: 60, depthLimit: 15 },
})) {
    const { type, content } = chunk.choices[0].delta;
    if (type === 'taskComplete') console.log(content);
}
```

---

## Providers

Pass a `provider` shorthand to get sensible defaults, or supply the full `ClientConfig` for full control.

### Provider shorthand (`ProviderConfig`)

| Field | Type | Description |
|---|---|---|
| `provider` | `'openai' \| 'gemini' \| 'ollama'` | Selects base URL and default model |
| `llmApiKey` | `string` | API key for the LLM provider |
| `model` | `string` | Override the default model |
| `baseUrl` | `string` | Override the provider base URL |
| `timeout` | `number` | Request timeout in ms |
| `e2bApiKey` | `string` | E2B API key for sandbox tools |
| `e2bTemplateId` | `string` | Custom E2B sandbox template |
| `e2bSecure` | `boolean` | Enable signed download URLs (required for `sandbox_download_url`) |
| `debug` | `boolean` | Enable verbose logging |

**Provider defaults:**

| Provider | Base URL | Default model |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.0-flash` |
| `ollama` | `http://localhost:11434/v1` | `llama3.2:3b` |

```typescript
// OpenAI
const client = new Client({ provider: 'openai', llmApiKey: '...' });

// Gemini
const client = new Client({ provider: 'gemini', llmApiKey: '...', model: 'gemini-2.5-pro' });

// Ollama (no key needed)
const client = new Client({ provider: 'ollama', model: 'qwen2.5:14b' });
```

### Full config (`ClientConfig`)

```typescript
const client = new Client({
    llmApiKey: '...',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    timeout: 60_000,
    e2bApiKey: '...',
    e2bSecure: true,
    systemMessages: 'You are a helpful agent.',
    debug: false,
    thinking_config: {           // Gemini extended thinking
        thinking_budget: 8192,
        include_thoughts: true,
    },
});
```

---

## Execution Modes

### Tree Mode

Opt in by passing `treeConfig` to `client.chat()`. The executor builds a reasoning tree where each tool call spawns a child node. Completed branches are compressed into summaries to keep the context window manageable.

```typescript
for await (const chunk of client.chat(task, {
    treeConfig: {
        nodeBudget: 100,       // max total nodes (default: 50)
        depthLimit: 20,        // max ThinkNode depth (default: 10)
        collapseThreshold: 4000, // chars before branch compression (default: 4000)
        retryMaxAttempts: 3,   // ToolNode max retries on failure (default: 3)
        retryBaseDelayMs: 1000, // first retry delay in ms (default: 1000)
        maxRepeatsPerSignature: 2, // max identical (tool, args) calls per path (default: 2)
    },
})) { ... }
```

**Tree features:**
- **Loop detection** — pruning branches that repeat the same `(tool, args)` signature beyond `maxRepeatsPerSignature`.
- **Automatic retries** — ToolNode retries failed tool calls with exponential backoff.
- **Context compression** — CollapseNode summarises deep branches before the parent continues.
- **Budget enforcement** — execution stops gracefully when `nodeBudget` or `depthLimit` is hit, emitting a `budgetExhausted` chunk.

### Linear Mode

Omit `treeConfig` for a classic recursive chat loop.

```typescript
for await (const chunk of client.chat(task, {
    maxDepth: 10,         // max recursion depth (default: 5)
    autoSummarize: true,  // summarise at end of conversation
})) { ... }
```

---

## Streaming Output

`client.chat()` is an async generator that yields `ChatChunk` objects. Each chunk carries a `type` and a `content` string.

```typescript
for await (const chunk of client.chat(task, { treeConfig: {} })) {
    const { type, content } = chunk.choices[0].delta;

    switch (type) {
        case 'internal':          // streaming LLM tokens
            process.stdout.write(content ?? '');
            break;
        case 'toolCall':          // tool pre/post execution (JSON)
            const obj = JSON.parse(content!);
            // obj.executed === false  → about to call
            // obj.executed === true   → result received
            console.log(`[${obj.executed ? '←' : '→'}] ${obj.tool}`);
            break;
        case 'collapse':          // branch compressed into summary
            console.log('[compressed]', content);
            break;
        case 'taskComplete':      // final answer — tree is done
            console.log('\n=== DONE ===\n', content);
            break;
        case 'budgetExhausted':   // nodeBudget or depthLimit hit
        case 'loopDetected':      // loop pruned
        case 'toolRetry':         // tool retry attempt
            console.log(`[${type}]`, content);
            break;
    }
}
```

### Chunk types

| Type | When emitted |
|---|---|
| `internal` | Streaming LLM text tokens |
| `toolCall` | Before and after every tool execution |
| `toolRetry` | Each retry attempt in ToolNode |
| `collapse` | When a branch is compressed by CollapseNode |
| `taskComplete` | `task_complete` tool called — tree is finished |
| `budgetExhausted` | `nodeBudget` or `depthLimit` reached |
| `loopDetected` | Loop signature matched, branch pruned |
| `maxDepthReached` | Linear mode max depth hit |
| `shouldContinue` | Linear mode continuation check |
| `conversationSummary` | Linear mode auto-summarise |

---

## Built-in Tools

The `Client` constructor auto-registers all built-in tools. Sandbox/code tools are hidden from the top-level LLM by default — they are only exposed to skill sub-agents.

### Visible tools (exposed to the LLM)

| Tool | Description |
|---|---|
| `get_current_time` | Current date/time in ISO 8601. Accepts an IANA timezone (e.g. `Asia/Kolkata`). |
| `fetch_url` | HTTP GET a URL. Returns status, headers, and body (truncated to `max_bytes`). |
| `http_post` | HTTP POST with a JSON body. Returns status and response. |

### Internal tools (sandbox — exposed to skills only)

| Tool | Description |
|---|---|
| `run_python` | Execute Python code in the E2B sandbox. State persists across calls. |
| `run_javascript` | Execute JavaScript (Node.js) code in the sandbox. |
| `run_typescript` | Execute TypeScript code in the sandbox. |
| `run_sandbox_command` | Run a shell command. Pass `background: true` for servers/long-running processes. |
| `get_sandbox_url` | Get the public HTTPS URL for an exposed sandbox port (e.g. a Flask server on port 5000). |
| `sandbox_read_file` | Read a file's contents from the sandbox. |
| `sandbox_write_file` | Write content to a file in the sandbox (creates parent dirs). |
| `sandbox_list_files` | List files/directories at a sandbox path. Accepts `depth`. |
| `sandbox_delete_file` | Delete a file or directory in the sandbox. |
| `sandbox_file_exists` | Check existence and get metadata for a sandbox path. |
| `sandbox_make_dir` | Create a directory (and parents) in the sandbox. |
| `sandbox_download_url` | Get a pre-signed HTTPS download URL for a sandbox file. Requires `e2bSecure: true`. |

### Selectively registering tools

```typescript
import { registerBuiltinTools } from 'tree-llm';

// Register all built-in tools (default)
registerBuiltinTools(client);

// Register only specific tools
registerBuiltinTools(client, ['get_current_time', 'fetch_url']);

// Register only web-safe tools (no code execution, no filesystem)
import { registerWebSafeTools } from 'tree-llm';
registerWebSafeTools(client);
```

---

## Built-in Skills

Skills are sub-agents: the parent LLM sees a single tool (`skill_<name>`), and calling it spawns a full sub-tree with its own system prompt and tool whitelist.

```typescript
import { registerBuiltinSkills } from 'tree-llm';

// Register all built-in skills
registerBuiltinSkills(client);

// Register only specific skills
registerBuiltinSkills(client, ['code_runner']);
```

### `code_runner`

Executes Python, JavaScript, or TypeScript in the E2B sandbox. Handles file I/O, shell commands, package installs, and server URLs.

**Available to this skill:** `run_python`, `run_javascript`, `run_typescript`, `run_sandbox_command`, `get_sandbox_url`, `sandbox_read_file`, `sandbox_write_file`, `sandbox_list_files`, `sandbox_delete_file`, `sandbox_file_exists`, `sandbox_make_dir`

### `web_researcher`

Fetches URLs and returns a concise factual summary with numbers, names, and dates preserved.

**Available to this skill:** `fetch_url`, `http_post`

---

## Custom Tools

```typescript
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

// Register as hidden (accessible to skills but not the top-level LLM)
client.registerTool('internal_tool', toolDef, { hidden: true });
```

---

## Custom Skills

```typescript
client.registerSkill('docx_skill', {
    description: 'Creates a formatted DOCX document. Use when the user asks to produce a Word file.',
    systemPrompt: 'You are a document formatting expert. Use python-docx via run_python to build the DOCX.',
    tools: [
        'run_python', 'run_sandbox_command',
        'sandbox_read_file', 'sandbox_write_file', 'sandbox_list_files',
        'sandbox_delete_file', 'sandbox_file_exists', 'sandbox_make_dir',
        'sandbox_download_url',
    ],
    treeConfig: { nodeBudget: 40, depthLimit: 10 },  // optional sub-tree overrides
});
```

The skill is exposed to the parent LLM as the tool `skill_docx_skill`. When called it runs its own tree and returns the `task_complete` result to the parent.

---

## E2B Sandbox

The sandbox is a secure cloud VM managed by [E2B](https://e2b.dev). It is created lazily on the first tool call and reused across all tool calls in a session.

### Setup

```bash
npm install @e2b/code-interpreter
```

Set `E2B_API_KEY` in your environment, or pass it via the client config:

```typescript
const client = new Client({
    provider: 'openai',
    llmApiKey: '...',
    e2bApiKey: process.env.E2B_API_KEY,
    e2bTemplateId: 'my-custom-template', // optional — uses E2B base template by default
    e2bSecure: true,                      // required for sandbox_download_url
});
```

### File download URLs

`sandbox_download_url` returns a pre-signed HTTPS URL that works directly in a browser — no auth headers needed.

```typescript
// The LLM calls this automatically, or you can call it manually:
import { configureE2B, getSandbox } from 'tree-llm';

configureE2B({ apiKey: '...', secure: true });
const sandbox = await getSandbox();

const url = await sandbox.downloadUrl('/home/user/report.pdf', {
    useSignatureExpiration: 60_000,  // URL valid for 60 seconds
});
console.log(url); // https://49983-<sandboxId>.e2b.app/files?path=...&signature=...
```

> **Note:** `e2bSecure: true` must be set before the sandbox is first created. Changing it after the first tool call has no effect until the session is reset.

---

## API Reference

### `new Client(config)`

Creates a new client. Accepts `ProviderConfig` (shorthand) or `ClientConfig` (full).

### `client.chat(content, options?, history?)`

Returns an `AsyncGenerator<ChatChunk>`. Options:

| Option | Type | Description |
|---|---|---|
| `treeConfig` | `TreeConfig` | Presence opts into tree mode. See [Tree Mode](#tree-mode). |
| `maxDepth` | `number` | Linear mode max recursion depth (default: 5). |
| `autoSummarize` | `boolean` | Linear mode — summarise at conversation end. |
| `reasoningEffort` | `'low' \| 'medium' \| 'high'` | Passed to providers that support it. |

### `client.registerTool(name, toolDef, options?)`

Registers a tool. `options.hidden = true` hides it from the top-level LLM but keeps it accessible to skills.

### `client.registerSkill(name, skillDef)`

Registers a skill as the tool `skill_<name>`. See [Custom Skills](#custom-skills).

### `client.getTools()`

Returns the tool definitions visible to the top-level LLM (excludes hidden/internal tools).

### `client.clearConversation()`

Clears all non-system messages from the conversation history.

### `client.getMessages()`

Returns the full message history.

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run the example
npm run example

# Lint
npm run lint

# Format
npm run format
```

### Environment variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
E2B_API_KEY=e2b_...
```

---

## License

MIT
