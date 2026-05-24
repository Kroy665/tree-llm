// Re-export all types
export * from './types';

// Export the main client class
export { Client } from './client';

// Export utility classes
export { Logger } from './utils/logger';

// Export built-in tools (auto-registered by Client — exported for advanced use)
export { registerBuiltinTools, registerWebSafeTools, builtinTools, WEB_SAFE_TOOLS } from './tools';
export type { BuiltinToolName } from './tools';

// Export built-in skills
export { registerBuiltinSkills, builtinSkills, codeRunnerSkill, webResearcherSkill } from './skills';
export type { BuiltinSkillName } from './skills';

// Export observability API
export { AgentObserver, ObserverContext } from './observer';
export type { AgentEvent, AgentEventType } from './observer';
export { createInspector } from './inspector';
export type { InspectorOptions } from './inspector';

// Default export for CommonJS/ESM interop
import { Client } from './client';
export default Client;
