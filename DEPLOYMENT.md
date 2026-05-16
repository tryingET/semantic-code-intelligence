# Deployment Configuration

## Quick Start

```bash
# 1. Initialize the system
just init

# 2. Migrate from old system
just migrate

# 3. Start development
just dev-mcp

# 4. Configure Claude Desktop
just configure-claude
```

## Core Implementation Files

### 1. Core Analyzer (core/analyzer.ts)

```typescript
// core/analyzer.ts
import { CacheService } from './services/cache'
import { DatabaseService } from './services/database'
import { LayerStack } from './layers/index'
import type { 
  CodeAnalyzer as ICodeAnalyzer,
  FindDefinitionParams,
  FindDefinitionResult,
  FindReferencesParams,
  FindReferencesResult
} from './types/api'

export class CodeAnalyzer implements ICodeAnalyzer {
  private layers: LayerStack
  private cache: CacheService
  private db: DatabaseService
  
  constructor() {
    this.cache = new CacheService()
    this.db = new DatabaseService()
    this.layers = new LayerStack(this.cache, this.db)
  }
  
  async initialize(): Promise<void> {
    await this.db.initialize()
    await this.cache.initialize()
    await this.layers.initialize()
    console.log('🧠 Core analyzer initialized')
  }
  
  async findDefinition(params: FindDefinitionParams): Promise<FindDefinitionResult> {
    // Check cache
    const cacheKey = `def:${params.symbol}:${params.location?.uri || 'global'}`
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      console.log(`✅ Cache hit for ${params.symbol}`)
      return cached
    }
    
    console.log(`🔍 Finding definition for ${params.symbol}`)
    
    // Progressive enhancement through layers
    let result = await this.layers.search.find(params)
    
    if (result.confidence < 0.8) {
      result = await this.layers.ast.enhance(result, params)
    }
    
    if (result.confidence < 0.9) {
      result = await this.layers.semantic.enhance(result, params)
    }
    
    // Learn from this query
    await this.layers.patterns.recordQuery(params, result)
    
    // Cache result
    await this.cache.set(cacheKey, result, { ttl: 3600 })
    
    return result
  }
  
  async findReferences(params: FindReferencesParams): Promise<FindReferencesResult> {
    const cacheKey = `ref:${params.symbol}:${params.location?.uri || 'global'}`
    const cached = await this.cache.get(cacheKey)
    if (cached) return cached
    
    console.log(`🔍 Finding references for ${params.symbol}`)
    
    let result = await this.layers.search.findReferences(params)
    result = await this.layers.ast.enhanceReferences(result, params)
    
    await this.cache.set(cacheKey, result, { ttl: 1800 })
    return result
  }
  
  async shutdown(): Promise<void> {
    await this.cache.shutdown()
    await this.db.shutdown()
    console.log('🛑 Core analyzer shut down')
  }
}
```

### 2. MCP Adapter (Streamable HTTP)

```typescript
// src/servers/mcp-http.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CodeAnalyzer } from "../../core/analyzer"
import { MCPTranslator } from "./translator"
import { MCP_TOOLS } from "./tools"

export class MCPAdapter {
  private server: Server
  private analyzer: CodeAnalyzer
  private translator: MCPTranslator
  
  constructor() {
    this.analyzer = new CodeAnalyzer()
    this.translator = new MCPTranslator()
    
    this.server = new Server(
      {
        name: "ontology-lsp",
        version: "2.0.0"
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    )
    
    this.setupHandlers()
  }
  
  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler("tools/list", async () => ({
      tools: MCP_TOOLS
    }))
    
    // Execute tool
    this.server.setRequestHandler("tools/call", async (request) => {
      const { name, arguments: args } = request.params
      
      try {
        // Translate MCP request to core format
        const coreParams = this.translator.fromMCP({ tool: name, arguments: args })
        
        // Call appropriate core method
        let result
        switch (name) {
          case 'find_definition':
            result = await this.analyzer.findDefinition(coreParams)
            break
          case 'find_references':
            result = await this.analyzer.findReferences(coreParams)
            break
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
        
        // Translate core response to MCP format
        return this.translator.toMCP(result)
      } catch (error) {
        console.error(`Error executing tool ${name}:`, error)
        return {
          content: [{
            type: "text",
            text: `Error: ${error.message}`
          }]
        }
      }
    })
  }
  
  async start() {
    await this.analyzer.initialize()
    
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    
    console.log("🤖 MCP adapter started")
  }
}

// Start the server
if (import.meta.main) {
  const adapter = new MCPAdapter()
  adapter.start().catch(console.error)
}
```

### 3. MCP Translator (adapters/mcp/translator.ts)

```typescript
// adapters/mcp/translator.ts
export class MCPTranslator {
  fromMCP(request: any): any {
    const { tool, arguments: args } = request
    
    switch (tool) {
      case 'find_definition':
        return {
          symbol: args.symbol,
          location: args.file ? {
            uri: `file://${args.file}`,
            line: args.line || 0,
            column: args.column || 0
          } : undefined,
          includeDeclaration: args.includeDeclaration ?? true
        }
        
      case 'find_references':
        return {
          symbol: args.symbol,
          location: args.file ? {
            uri: `file://${args.file}`,
            line: args.line || 0,
            column: args.column || 0
          } : undefined,
          includeDeclaration: args.includeDeclaration ?? false
        }
        
      default:
        throw new Error(`Unknown tool: ${tool}`)
    }
  }
  
  toMCP(response: any): any {
    if (response.definitions) {
      // Format find_definition response
      const definitions = response.definitions.map(def => 
        `📍 ${def.name} (${def.kind}) at ${def.location.uri}:${def.location.line + 1}:${def.location.column + 1}`
      ).join('\n')
      
      return {
        content: [{
          type: "text",
          text: definitions || "No definitions found"
        }]
      }
    }
    
    if (response.references) {
      // Format find_references response
      const refs = response.references.map(ref =>
        `📍 ${ref.location.uri}:${ref.location.line + 1} - ${ref.preview}`
      ).join('\n')
      
      return {
        content: [{
          type: "text",
          text: `Found ${response.total} references:\n${refs}`
        }]
      }
    }
    
    // Generic response
    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }]
    }
  }
}
```

### 4. Layer Stack (core/layers/index.ts)

```typescript
// core/layers/index.ts
import { SearchLayer } from './search'
import { ASTLayer } from './ast'
import { SemanticLayer } from './semantic'
import { PatternLayer } from './patterns'
import { KnowledgeLayer } from './knowledge'

export class LayerStack {
  search: SearchLayer
  ast: ASTLayer
  semantic: SemanticLayer
  patterns: PatternLayer
  knowledge: KnowledgeLayer
  
  constructor(cache: any, db: any) {
    this.search = new SearchLayer(cache)
    this.ast = new ASTLayer(cache)
    this.semantic = new SemanticLayer(db)
    this.patterns = new PatternLayer(db)
    this.knowledge = new KnowledgeLayer(db)
  }
  
  async initialize() {
    await Promise.all([
      this.search.initialize(),
      this.ast.initialize(),
      this.semantic.initialize(),
      this.patterns.initialize(),
      this.knowledge.initialize()
    ])
  }
}
```

## Docker Configuration

### Dockerfile

```dockerfile
# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Build application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production image
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 bunjs

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules

# Create data directories
RUN mkdir -p .ontology/db .ontology/cache .ontology/logs
RUN chown -R bunjs:nodejs .ontology

USER bunjs

# Expose ports
EXPOSE 7000 7001 7002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:7000/health || exit 1

# Start all adapters
CMD ["bun", "run", "dist/start-all.js"]
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  ontology-core:
    build: .
    container_name: ontology-core
    ports:
      - "7000:7000"  # HTTP API
      - "7001:7001"  # MCP
      - "7002:7002"  # LSP
    volumes:
      - ontology-data:/app/.ontology
      - ./config:/app/config:ro
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - CACHE_REDIS_URL=redis://cache:6379
    depends_on:
      - cache
      - db
    restart: unless-stopped

  cache:
    image: redis:7-alpine
    container_name: ontology-cache
    ports:
      - "6379:6379"
    volumes:
      - cache-data:/data
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    container_name: ontology-db
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=ontology
      - POSTGRES_USER=ontology
      - POSTGRES_PASSWORD=secure-password-here
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  ontology-data:
  cache-data:
  db-data:
```

## Environment Configuration

### .env.example

```bash
# .env.example
# Copy to .env and customize

# Server Configuration
NODE_ENV=development
LOG_LEVEL=info

# Ports
HTTP_PORT=7000
MCP_PORT=7001
LSP_PORT=7002

# Database
DATABASE_URL=postgresql://ontology:password@localhost:5432/ontology
# For development, use SQLite
DATABASE_URL=sqlite://.ontology/db/ontology.db

# Cache
CACHE_ENABLED=true
CACHE_TTL=3600
CACHE_REDIS_URL=redis://localhost:6379

# Performance
MAX_WORKERS=4
REQUEST_TIMEOUT=30000
MAX_CONCURRENT_REQUESTS=100

# Paths
WORKSPACE_ROOT=/home/user/projects
ONTOLOGY_DATA_DIR=.ontology

# Feature Flags
ENABLE_LEARNING=true
ENABLE_PATTERNS=true
ENABLE_SEMANTIC=true
```

### Configuration Schema (config/default.ts)

```typescript
// config/default.ts
export const defaultConfig = {
  server: {
    host: process.env.HOST || 'localhost',
    ports: {
      http: parseInt(process.env.HTTP_PORT || '7000'),
      mcp: parseInt(process.env.MCP_PORT || '7001'),
      lsp: parseInt(process.env.LSP_PORT || '7002')
    }
  },
  
  database: {
    url: process.env.DATABASE_URL || 'sqlite://.ontology/db/ontology.db',
    pool: {
      min: 2,
      max: 10
    }
  },
  
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: parseInt(process.env.CACHE_TTL || '3600'),
    redis: process.env.CACHE_REDIS_URL
  },
  
  performance: {
    maxWorkers: parseInt(process.env.MAX_WORKERS || '4'),
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000'),
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '100')
  },
  
  features: {
    learning: process.env.ENABLE_LEARNING !== 'false',
    patterns: process.env.ENABLE_PATTERNS !== 'false',
    semantic: process.env.ENABLE_SEMANTIC !== 'false'
  }
}
```

## Claude Desktop Configuration

### claude_desktop_config.json

```json
{
  "mcpServers": {
    "ontology-lsp": {
      "command": "bun",
      "args": [
        "run",
        "/path/to/ontology-lsp/dist/adapters/mcp/index.js"
      ],
      "env": {
        "LOG_LEVEL": "info",
        "WORKSPACE_ROOT": "/path/to/your/projects"
      }
    }
  }
}
```

## Deployment Scripts

### scripts/deploy.sh

```bash
#!/bin/bash
# scripts/deploy.sh

set -e

echo "🚀 Deploying Ontology-LSP..."

# Build
echo "📦 Building..."
just build-prod

# Run tests
echo "🧪 Testing..."
just test

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t ontology-lsp:latest .

# Tag for registry
echo "🏷️ Tagging..."
docker tag ontology-lsp:latest registry.example.com/ontology-lsp:latest
docker tag ontology-lsp:latest registry.example.com/ontology-lsp:$(git rev-parse --short HEAD)

# Push to registry
echo "📤 Pushing to registry..."
docker push registry.example.com/ontology-lsp:latest
docker push registry.example.com/ontology-lsp:$(git rev-parse --short HEAD)

# Deploy to Kubernetes
echo "☸️ Deploying to Kubernetes..."
kubectl apply -f k8s/

# Wait for rollout
echo "⏳ Waiting for rollout..."
kubectl rollout status deployment/ontology-lsp

echo "✅ Deployment complete!"
```

### Kubernetes Deployment (k8s/deployment.yaml)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ontology-lsp
  labels:
    app: ontology-lsp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ontology-lsp
  template:
    metadata:
      labels:
        app: ontology-lsp
    spec:
      containers:
      - name: ontology-lsp
        image: registry.example.com/ontology-lsp:latest
        ports:
        - containerPort: 7000
          name: http
        - containerPort: 7001
          name: mcp
        - containerPort: 7002
          name: lsp
        env:
        - name: NODE_ENV
          value: "production"
        - name: LOG_LEVEL
          value: "info"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 7000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 7000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ontology-lsp
spec:
  selector:
    app: ontology-lsp
  ports:
  - name: http
    port: 7000
    targetPort: 7000
  - name: mcp
    port: 7001
    targetPort: 7001
  - name: lsp
    port: 7002
    targetPort: 7002
  type: LoadBalancer
```

## Monitoring Setup

### Prometheus Metrics

```typescript
// core/metrics.ts
import { register, Counter, Histogram, Gauge } from 'prom-client'

export const metrics = {
  requests: new Counter({
    name: 'ontology_requests_total',
    help: 'Total number of requests',
    labelNames: ['method', 'status']
  }),
  
  duration: new Histogram({
    name: 'ontology_request_duration_seconds',
    help: 'Request duration in seconds',
    labelNames: ['method'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5]
  }),
  
  cacheHits: new Counter({
    name: 'ontology_cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['type']
  }),
  
  activeSessions: new Gauge({
    name: 'ontology_active_sessions',
    help: 'Number of active sessions'
  })
}

export function getMetrics() {
  return register.metrics()
}
```

## Getting Started

```bash
# 1. Clone and setup
git clone https://github.com/yourusername/ontology-lsp.git
cd ontology-lsp

# 2. Install dependencies
bun install

# 3. Initialize the system
just init

# 4. Start development
just dev-mcp

# 5. In another terminal, test the connection
just test-mcp-connection

# 6. Configure Claude Desktop
just configure-claude

# 7. Restart Claude and test
# Ask Claude: "What tools do you have available?"
```

This deployment configuration provides everything needed to get the unified system running with the MCP adapter for clients.
