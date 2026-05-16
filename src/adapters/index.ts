/**
 * Adapters module - Export all protocol adapters and utilities
 */

export type { CLIAdapterConfig } from './cli-adapter.js';
export { CLIAdapter } from './cli-adapter.js';
export type {
    HTTPAdapterConfig,
    HTTPRequest,
    HTTPResponse,
} from './http-adapter.js';
export { HTTPAdapter } from './http-adapter.js';
// Type exports for configuration
export type { LSPAdapterConfig } from './lsp-adapter.js';
// Protocol-specific adapters
export { LSPAdapter } from './lsp-adapter.js';

export type { MCPAdapterConfig } from './mcp-adapter.js';
export { MCPAdapter } from './mcp-adapter.js';
// Helper types for adapter errors
export type { AdapterError } from './utils.js';
// Shared utilities used by all adapters
export * from './utils.js';
