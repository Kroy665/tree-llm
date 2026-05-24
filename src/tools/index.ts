import type { Client } from '../client';
export type { SkillDefinition } from '../types';

// ─── Individual tool exports ──────────────────────────────────────────────────
export { get_current_time } from './datetime';
export { read_file, write_file, list_files, delete_file, file_exists } from './filesystem';
export { fetch_url, http_post } from './web';
export { run_command } from './shell';
export { run_python, run_javascript, run_typescript, get_sandbox_url, run_sandbox_command } from './code';

// ─── Tool groups ──────────────────────────────────────────────────────────────

import { get_current_time } from './datetime';
import { read_file, write_file, list_files, delete_file, file_exists } from './filesystem';
import { fetch_url, http_post } from './web';
import { run_command } from './shell';
import { run_python, run_javascript, run_typescript, get_sandbox_url, run_sandbox_command } from './code';

export const builtinTools = {
    // DateTime
    get_current_time,

    // Filesystem
    read_file,
    write_file,
    list_files,
    delete_file,
    file_exists,

    // Web
    fetch_url,
    http_post,

    // Shell
    run_command,

    // E2B sandboxed code execution
    run_python,
    run_javascript,
    run_typescript,
    get_sandbox_url,
    run_sandbox_command,
} as const;

export type BuiltinToolName = keyof typeof builtinTools;

/** Tools safe to expose in a web app — no filesystem, shell, or code execution. */
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
