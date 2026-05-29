// Executable stdio entrypoint: install the stdout guard before loading MCP server dependencies.
import './mcp-stdio-bootstrap.js';

import { runFastMCPServer } from './mcp-fast.js';

runFastMCPServer().catch((error) => {
    process.stderr.write(
        `Failed to start MCP fast server: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
});
