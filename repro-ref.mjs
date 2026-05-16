import { LayerManager } from './src/core/layer-manager.js';
import { SharedServices } from './src/core/services/index.js';
import { CodeAnalyzer } from './src/core/unified-analyzer.js';
import { LSPAdapter } from './src/adapters/lsp-adapter.js';
import { MCPAdapter } from './src/adapters/mcp-adapter.js';
import { HTTPAdapter } from './src/adapters/http-adapter.js';
import { CLIAdapter } from './src/adapters/cli-adapter.js';

const config = {
  workspaceRoot: '/consistency-test-workspace',
  layers: {
    layer1: { enabled: true, timeout: 50 },
    layer2: { enabled: true, timeout: 100 },
    layer3: { enabled: true, timeout: 50 },
    layer4: { enabled: true, timeout: 50 },
    layer5: { enabled: true, timeout: 100 },
  },
  cache: { enabled: true, strategy: 'memory', memory: { maxSize: 10000*1024, ttl: 1200 } },
  database: { path: ':memory:', maxConnections: 15 },
  performance: { targetResponseTime: 100, maxConcurrentRequests: 50, healthCheckInterval: 30000 },
  monitoring: { enabled: false, metricsInterval: 60000, logLevel: 'error', tracing: { enabled: false, sampleRate: 0 }},
};

const symbol = 'ConsistencyTestFunction';
const file = 'file:///test/consistency.ts';
const position = { line: 15, character: 10 };

(async () => {
  const sharedServices = new SharedServices(config);
  await sharedServices.initialize();
  const layerManager = new LayerManager(config, sharedServices.eventBus);
  await layerManager.initialize();
  const codeAnalyzer = new CodeAnalyzer(layerManager, sharedServices, config, sharedServices.eventBus);
  await codeAnalyzer.initialize();

  const lsp = new LSPAdapter(codeAnalyzer, {});
  const mcp = new MCPAdapter(codeAnalyzer, {});
  const http = new HTTPAdapter(codeAnalyzer, { port: 7099, host: 'localhost' });
  const cli = new CLIAdapter(codeAnalyzer, {});
  await Promise.all([lsp.initialize(), mcp.initialize(), http.initialize(), cli.initialize()]);

  const start = Date.now();
  console.log('Running core.findReferences...');
  const coreRes = await codeAnalyzer.findReferences({ identifier: symbol, uri: file, position, includeDeclaration: true });
  console.log('core refs:', coreRes.data.length, 'in', Date.now()-start,'ms');

  console.log('Running LSP handleReferences...');
  const lspRes = await lsp.handleReferences({ textDocument: { uri: file }, position, context: { includeDeclaration: true }});
  console.log('lsp refs:', Array.isArray(lspRes) ? lspRes.length : 0);

  console.log('Running MCP executeTool...');
  const mcpRes = await mcp.executeTool({ name: 'find_references', arguments: { symbol, includeDeclaration: true, scope:'workspace' }});
  console.log('mcp done.');

  console.log('Running HTTP handleRequest...');
  const httpResp = await http.handleRequest({ method: 'POST', url: '/api/v1/references', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: symbol, uri: file, includeDeclaration: true })});
  console.log('http status', httpResp.status);

  console.log('Running CLI executeCommand...');
  const cliRes = await cli.executeCommand(['references', symbol, '--include-declaration']);
  console.log('cli done');

  await Promise.all([lsp.dispose(), mcp.dispose(), http.dispose(), cli.dispose()]);
  await codeAnalyzer.dispose();
  await layerManager.dispose();
  await sharedServices.dispose();
})();
