import type { ToolDefinition } from '../types';
import { getSandbox } from './code';

export const sandbox_read_file: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'sandbox_read_file',
            description: 'Read the contents of a file inside the E2B sandbox.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file inside the sandbox.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const content = await sandbox.files.read(path as string);
        return { path, content };
    },
};

export const sandbox_write_file: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'sandbox_write_file',
            description: 'Write content to a file inside the E2B sandbox. Creates parent directories if needed.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file inside the sandbox.' },
                    content: { type: 'string', description: 'Text content to write.' },
                },
                required: ['path', 'content'],
            },
        },
    },
    handler: async ({ path, content }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const info = await sandbox.files.write(path as string, content as string);
        return { path, written: (content as string).length, info };
    },
};

export const sandbox_list_files: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'sandbox_list_files',
            description: 'List files and directories at a path inside the E2B sandbox.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to list inside the sandbox.' },
                    depth: { type: 'number', description: 'How many directory levels to recurse. Default: 1.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path, depth = 1 }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        const entries = await sandbox.files.list(path as string, { depth: depth as number });
        return {
            path,
            count: entries.length,
            entries: entries.map(e => ({ name: e.name, type: e.type, path: e.path })),
        };
    },
};

export const sandbox_delete_file: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'sandbox_delete_file',
            description: 'Delete a file or directory inside the E2B sandbox.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the file or directory to delete inside the sandbox.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        await sandbox.files.remove(path as string);
        return { deleted: path };
    },
};

export const sandbox_file_exists: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'sandbox_file_exists',
            description: 'Check whether a file or directory exists inside the E2B sandbox and return its metadata.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to check inside the sandbox.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        try {
            const info = await sandbox.files.getInfo(path as string);
            return { exists: true, type: info.type, path: info.path, name: info.name };
        } catch {
            return { exists: false, path };
        }
    },
};

export const sandbox_make_dir: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'sandbox_make_dir',
            description: 'Create a directory (and any missing parent directories) inside the E2B sandbox.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to create inside the sandbox.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path }: Record<string, unknown>) => {
        const sandbox = await getSandbox();
        await sandbox.files.makeDir(path as string);
        return { created: path };
    },
};
