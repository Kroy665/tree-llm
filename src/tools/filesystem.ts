import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../client';

export const read_file: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file from the local filesystem.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative file path.' },
                    encoding: {
                        type: 'string',
                        description: 'File encoding. Default: "utf8".',
                        enum: ['utf8', 'base64'],
                    },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path: filePath, encoding = 'utf8' }: Record<string, unknown>) => {
        const resolved = path.resolve(filePath as string);
        const content = await fs.readFile(resolved, (encoding as BufferEncoding));
        const stat = await fs.stat(resolved);
        return { path: resolved, content, size: stat.size, encoding };
    },
};

export const write_file: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file. Creates the file (and parent directories) if they do not exist. Overwrites existing content.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative file path.' },
                    content: { type: 'string', description: 'Content to write.' },
                    append: {
                        type: 'boolean',
                        description: 'If true, appends to the file instead of overwriting. Default: false.',
                    },
                },
                required: ['path', 'content'],
            },
        },
    },
    handler: async ({ path: filePath, content, append = false }: Record<string, unknown>) => {
        const resolved = path.resolve(filePath as string);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        if (append) {
            await fs.appendFile(resolved, content as string, 'utf8');
        } else {
            await fs.writeFile(resolved, content as string, 'utf8');
        }
        const stat = await fs.stat(resolved);
        return { path: resolved, written: (content as string).length, size: stat.size, appended: !!append };
    },
};

export const list_files: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files and directories at a path. Optionally recurse into subdirectories.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to list. Defaults to current working directory.' },
                    recursive: { type: 'boolean', description: 'If true, list files recursively. Default: false.' },
                    filter: { type: 'string', description: 'Only include entries whose name contains this substring (case-insensitive).' },
                },
            },
        },
    },
    handler: async ({ path: dirPath = '.', recursive = false, filter }: Record<string, unknown>) => {
        const resolved = path.resolve(dirPath as string);
        const entries = await fs.readdir(resolved, {
            withFileTypes: true,
            recursive: recursive as boolean,
        } as any);

        const items = (entries as any[]).map((e: any) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            path: path.join(resolved, e.name),
        }));

        const filtered = filter
            ? items.filter(i => i.name.toLowerCase().includes((filter as string).toLowerCase()))
            : items;

        return { path: resolved, count: filtered.length, entries: filtered };
    },
};

export const delete_file: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file or an empty directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the file or directory to delete.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path: filePath }: Record<string, unknown>) => {
        const resolved = path.resolve(filePath as string);
        await fs.rm(resolved, { recursive: false });
        return { deleted: resolved };
    },
};

export const file_exists: ToolDefinition = {
    definition: {
        type: 'function',
        function: {
            name: 'file_exists',
            description: 'Check whether a file or directory exists and return its metadata.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to check.' },
                },
                required: ['path'],
            },
        },
    },
    handler: async ({ path: filePath }: Record<string, unknown>) => {
        const resolved = path.resolve(filePath as string);
        try {
            const stat = await fs.stat(resolved);
            return {
                exists: true,
                type: stat.isDirectory() ? 'directory' : 'file',
                size: stat.size,
                modified: stat.mtime.toISOString(),
                path: resolved,
            };
        } catch {
            return { exists: false, path: resolved };
        }
    },
};
