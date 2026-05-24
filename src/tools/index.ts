import type { Client } from '../client';
export type { SkillDefinition } from '../types';

// ─── Individual tool exports ──────────────────────────────────────────────────
export { get_current_time } from './datetime';
export { fetch_url, http_post } from './web';
export { run_python, run_javascript, run_typescript, get_sandbox_url, run_sandbox_command } from './code';
export { sandbox_read_file, sandbox_write_file, sandbox_list_files, sandbox_delete_file, sandbox_file_exists, sandbox_make_dir } from './sandbox-fs';

// ─── Tool groups ──────────────────────────────────────────────────────────────

import { get_current_time } from './datetime';
import { fetch_url, http_post } from './web';
import { run_python, run_javascript, run_typescript, get_sandbox_url, run_sandbox_command } from './code';
import { sandbox_read_file, sandbox_write_file, sandbox_list_files, sandbox_delete_file, sandbox_file_exists, sandbox_make_dir } from './sandbox-fs';

export const builtinTools = {
    // DateTime
    get_current_time,

    // Web
    fetch_url,
    http_post,

    // E2B sandboxed code execution
    run_python,
    run_javascript,
    run_typescript,
    get_sandbox_url,
    run_sandbox_command,

    // E2B sandboxed filesystem
    sandbox_read_file,
    sandbox_write_file,
    sandbox_list_files,
    sandbox_delete_file,
    sandbox_file_exists,
    sandbox_make_dir,
} as const;

export type BuiltinToolName = keyof typeof builtinTools;

/** Tools safe to expose in a web app — no code execution. */
export const WEB_SAFE_TOOLS: BuiltinToolName[] = ['get_current_time', 'fetch_url', 'http_post'];

/**
 * Register a subset (or all) of built-in tools on a Client instance.
 *
 * @example
 * // Register all built-in tools (server-side only)
 * registerBuiltinTools(client);
 *
 * // Register only specific tools
 * registerBuiltinTools(client, ['read_file', 'write_file', 'run_command']);
 */
export function registerBuiltinTools(
    client: Client,
    tools: BuiltinToolName[] = Object.keys(builtinTools) as BuiltinToolName[]
): void {
    for (const name of tools) {
        client.registerTool(name, builtinTools[name]);
    }
}

/**
 * Register only web-safe tools (datetime + HTTP).
 * Never exposes filesystem, shell, or code-execution tools.
 *
 * @example
 * registerWebSafeTools(client);
 */
export function registerWebSafeTools(client: Client): void {
    registerBuiltinTools(client, WEB_SAFE_TOOLS);
}
