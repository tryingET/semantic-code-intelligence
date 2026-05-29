// Executable stdio entrypoint: install the stdout guard before loading MCP server dependencies.
import './mcp-stdio-bootstrap.js';

import { runMCPServer } from './mcp.js';

runMCPServer().catch((error) => {
    process.stderr.write(`Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
