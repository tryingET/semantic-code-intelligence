#!/usr/bin/env bun
/**
 * Debug MCP Server - Logs all incoming requests to help diagnose connection issues
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Disable all output except protocol messages
process.env.SILENT_MODE = 'true';
process.env.STDIO_MODE = 'true';

const server = new Server(
  {
    name: "debug-ontology-lsp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Log to stderr so it doesn't interfere with stdio protocol
function debugLog(message, data) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// Add request logging middleware
const originalSetRequestHandler = server.setRequestHandler.bind(server);
server.setRequestHandler = function(schema, handler) {
  const wrappedHandler = async (request) => {
    debugLog(`Incoming request: ${request.method}`, {
      method: request.method,
      params: request.params,
      id: request.id
    });
    
    try {
      const result = await handler(request);
      debugLog(`Request ${request.method} completed successfully`);
      return result;
    } catch (error) {
      debugLog(`Request ${request.method} failed:`, {
        error: error.message,
        code: error.code
      });
      throw error;
    }
  };
  
  return originalSetRequestHandler(schema, wrappedHandler);
};

// Minimal handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            test: { type: "string" }
          },
          required: ["test"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return {
    content: [
      {
        type: "text",
        text: `Tool called: ${request.params.name} with args: ${JSON.stringify(request.params.arguments)}`
      }
    ],
    isError: false
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: [] };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts: [] };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${request.params.name}`);
});

// Start server
async function main() {
  debugLog("Starting debug MCP server...");
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  debugLog("Debug MCP server connected and listening");
}

main().catch(error => {
  debugLog("Server failed to start:", { error: error.message });
  process.exit(1);
});