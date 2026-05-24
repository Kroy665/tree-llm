import type { SkillDefinition } from '../types';

export const codeRunnerSkill: SkillDefinition = {
    description:
        'Executes Python, JavaScript, or TypeScript code in a secure E2B cloud sandbox and returns the output. ' +
        'Can also read, write, and manage files inside the sandbox. ' +
        'Use for computations, data processing, file generation, or running scripts.',
    systemPrompt:
        'You are a code execution expert running inside a secure E2B cloud sandbox. ' +
        'Write clean, correct code and run it using the available sandbox tools. ' +
        'Use sandbox_write_file / sandbox_read_file for file operations inside the sandbox. ' +
        'Prefer run_python for data tasks, run_javascript for Node tasks.',
    tools: [
        'run_python', 'run_javascript', 'run_typescript',
        'run_sandbox_command', 'get_sandbox_url',
        'sandbox_read_file', 'sandbox_write_file', 'sandbox_list_files',
        'sandbox_delete_file', 'sandbox_file_exists', 'sandbox_make_dir',
    ],
};
