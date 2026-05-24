// Re-export all types
export * from './types';

// Export the main client class
export { Client } from './client';

// Export utility classes
export { Logger } from './utils/logger';

// Export built-in tools
export { registerBuiltinTools, registerWebSafeTools, builtinTools, WEB_SAFE_TOOLS } from './tools';
export type { BuiltinToolName } from './tools';

// Default export for CommonJS/ESM interop
import { Client } from './client';
export default Client;
