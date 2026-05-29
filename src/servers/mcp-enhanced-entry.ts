// Executable stdio entrypoint: install the stdout guard before loading MCP server dependencies.
import './mcp-stdio-bootstrap.js';

import { mcpLogger } from '../mcp/file-logger.js';
import { runEnhancedMCPServer } from './mcp-enhanced.js';

runEnhancedMCPServer().catch((error) => {
    mcpLogger.error('Failed to start Enhanced MCP server', error);
    process.exit(1);
});
