import type { Client } from '../client';
import type { SkillDefinition } from '../types';

export { codeRunnerSkill } from './code-runner';
export { webResearcherSkill } from './web-researcher';

import { codeRunnerSkill } from './code-runner';
import { webResearcherSkill } from './web-researcher';

export const builtinSkills: Record<string, SkillDefinition> = {
    code_runner: codeRunnerSkill,
    web_researcher: webResearcherSkill,
};

export type BuiltinSkillName = keyof typeof builtinSkills;

/**
 * Register all (or a subset of) built-in skills on a Client instance.
 *
 * @example
 * registerBuiltinSkills(client);
 * registerBuiltinSkills(client, ['code_runner']);
 */
export function registerBuiltinSkills(
    client: Client,
    skills: BuiltinSkillName[] = Object.keys(builtinSkills) as BuiltinSkillName[]
): void {
    for (const name of skills) {
        client.registerSkill(name, builtinSkills[name]);
    }
}
