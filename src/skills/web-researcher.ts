import type { SkillDefinition } from '../types';

export const webResearcherSkill: SkillDefinition = {
    description:
        'Fetches and summarises content from URLs. ' +
        'Use when you need to retrieve information from the web.',
    systemPrompt:
        'You are a web research assistant. Fetch the given URLs, extract the key information, ' +
        'and return a concise factual summary. Preserve numbers, names, and dates exactly.',
    tools: ['fetch_url', 'http_post'],
};
