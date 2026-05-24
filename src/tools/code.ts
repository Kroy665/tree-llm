import { Sandbox } from '@e2b/code-interpreter';
import type { ToolDefinition } from '../types';

let _sandbox: Sandbox | null = null;
let _e2bConfig: { apiKey?: string; templateId?: string } = {};

export function configureE2B(config: { apiKey?: string; templateId?: string }): void {
    _e2bConfig = config;
    // Reset sandbox so the next call picks up the new config
    _sandbox?.kill().catch(() => {});
    _sandbox = null;
}

export async function getSandbox(): Promise<Sandbox> {
    if (!_sandbox) {
        const apiKey = _e2bConfig.apiKey ?? process.env.E2B_API_KEY;
        if (!apiKey) throw new Error('E2B_API_KEY is not set. Pass e2bApiKey to the Client or set the E2B_API_KEY env var.');
        _sandbox = await Sandbox.create({
            apiKey,
            ...(_e2bConfig.templateId && { template: _e2bConfig.templateId }),
        });
    }
    return _sandbox;
}

// Best-effort cleanup when the process exits
process.on('exit', () => { _sandbox?.kill().catch(() => {}); });
process.on('SIGINT', () => { _sandbox?.kill().catch(() => {}); process.exit(0); });

function formatExecution(exec: Awaited<ReturnType<Sandbox['runCode']>>, language: string) {
    const stdout = exec.logs.stdout.join('');
    const stderr = exec.logs.stderr.join('');
    const textResults = exec.results
        .filter(r => r.text)
        .map(r => r.text)
        .join('\n');

    if (exec.error) {
        return {
            success: false,
            language,
            error: exec.error.name + ': ' + exec.error.value,
            traceback: exec.error.traceback,
            stdout: stdout || undefined,
            stderr: stderr || undefined,
        };
    }

    return {
        success: true,
        language,
        output: [stdout, textResults].filter(Boolean).join('\n') || '(no output)',
        stderr: stderr || undefined,
    };
}

export const run_python: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'run_python',
            description:
                'Execute Python code in a secure E2B cloud sandbox. ' +
                'Supports pip installs, file I/O, matplotlib, pandas, numpy, etc. ' +
                'State is preserved between calls within the same session.',
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'Python code to execute.',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Execution timeout in seconds. Default: 30.',
                    },
                },
                required: ['code'],
            },
        },
    },
    handler: async ({ code, timeout = 30 }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const exec = await sandbox.runCode(code as string, {
            language: 'python',
            timeoutMs: (timeout as number) * 1000,
        });
        return formatExecution(exec, 'python');
    },
};

export const run_javascript: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'run_javascript',
            description:
                'Execute JavaScript (Node.js) code in a secure E2B cloud sandbox. ' +
                'State is preserved between calls within the same session.',
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'JavaScript code to execute.',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Execution timeout in seconds. Default: 30.',
                    },
                },
                required: ['code'],
            },
        },
    },
    handler: async ({ code, timeout = 30 }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const exec = await sandbox.runCode(code as string, {
            language: 'javascript',
            timeoutMs: (timeout as number) * 1000,
        });
        return formatExecution(exec, 'javascript');
    },
};

export const get_sandbox_url: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'get_sandbox_url',
            description:
                'Get the public HTTPS URL for a port exposed inside the E2B sandbox. ' +
                'Use this after starting a server (e.g. Flask on port 5000, Node on port 3000) ' +
                'to get the URL that can be accessed from the internet.',
            parameters: {
                type: 'object',
                properties: {
                    port: {
                        type: 'number',
                        description: 'The port number the server is listening on inside the sandbox.',
                    },
                },
                required: ['port'],
            },
        },
    },
    handler: async ({ port }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const host = sandbox.getHost(port as number);
        return {
            port,
            url: `https://${host}`,
            host,
        };
    },
};

export const run_sandbox_command: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'run_sandbox_command',
            description:
                'Run a shell command inside the E2B sandbox (e.g. pip install, npm install, start a background process). ' +
                'Use background:true for servers or long-running processes.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Shell command to execute.',
                    },
                    background: {
                        type: 'boolean',
                        description: 'If true, run the command in the background and return immediately. Default: false.',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in seconds for foreground commands. Default: 30.',
                    },
                },
                required: ['command'],
            },
        },
    },
    handler: async ({ command, background = false, timeout = 30 }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        if (background) {
            const proc = await sandbox.commands.run(command as string, { background: true });
            return { background: true, pid: proc.pid, command };
        }
        const result = await sandbox.commands.run(command as string, {
            timeoutMs: (timeout as number) * 1000,
        });
        return {
            background: false,
            command,
            stdout: result.stdout?.trim() || '(no output)',
            stderr: result.stderr?.trim() || undefined,
            exitCode: result.exitCode,
            success: result.exitCode === 0,
        };
    },
};

export const run_typescript: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'run_typescript',
            description:
                'Execute TypeScript code in a secure E2B cloud sandbox. ' +
                'State is preserved between calls within the same session.',
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'TypeScript code to execute.',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Execution timeout in seconds. Default: 30.',
                    },
                },
                required: ['code'],
            },
        },
    },
    handler: async ({ code, timeout = 30 }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const exec = await sandbox.runCode(code as string, {
            language: 'typescript',
            timeoutMs: (timeout as number) * 1000,
        });
        return formatExecution(exec, 'typescript');
    },
};
