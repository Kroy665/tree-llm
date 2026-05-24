import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../client';

const execAsync = promisify(exec);

export const run_command: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'run_command',
            description:
                'Execute a shell command and return stdout, stderr, and exit code. ' +
                'Use for running scripts, CLI tools, compilers, package managers, etc. ' +
                'Times out after 30 seconds.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to execute.' },
                    cwd: {
                        type: 'string',
                        description: 'Working directory for the command. Defaults to current directory.',
                    },
                    timeout_ms: {
                        type: 'number',
                        description: 'Timeout in milliseconds. Default: 30000.',
                    },
                },
                required: ['command'],
            },
        },
    },
    handler: async ({ command, cwd, timeout_ms = 30_000 }: Record<string, unknown>) => {
        try {
            const { stdout, stderr } = await execAsync(command as string, {
                cwd: cwd as string | undefined,
                timeout: timeout_ms as number,
                maxBuffer: 1024 * 1024, // 1 MB
            });
            return {
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exit_code: 0,
                command,
            };
        } catch (err: any) {
            return {
                success: false,
                stdout: err.stdout?.trim() ?? '',
                stderr: err.stderr?.trim() ?? err.message,
                exit_code: err.code ?? 1,
                command,
            };
        }
    },
};
