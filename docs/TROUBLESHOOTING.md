# Ontology-LSP Troubleshooting Guide

This comprehensive troubleshooting guide will help you diagnose and resolve common issues with the Ontology-LSP system.

## 🚨 Emergency Quick Start

If you're experiencing critical issues:

```bash
# 1. Stop everything
just stop

# 2. Clean state
find .ontology -name "*.db*" -delete
rm -rf .ontology/logs/* .ontology/pids/*

# 3. Check environment
echo "Bun version: $(bun --version)"
which bun

# 4. Start fresh
just start

# 5. Check health
just health
```

## 📋 Quick Diagnostic Checklist

Run these commands to quickly identify issues:

```bash
# System status
just status              # Check server processes
just health              # Check HTTP endpoints
lsof -i :7000-7002      # Check port usage

# Resource usage
ps aux | grep bun        # Check Bun processes
free -h                  # Check memory
df -h                    # Check disk space

# Logs
tail -f .ontology/logs/*.log  # Real-time logs
grep -i error .ontology/logs/*.log  # Error messages

# Configuration
bun run src/core/config/server-config.ts  # Test config
ls -la .ontology/        # Check permissions
```

## 🔧 Common Issues & Solutions

### 1. Server Startup Issues

#### Server Won't Start

**Symptoms:**
- `just start` returns immediately
- No PIDs in `.ontology/pids/`
- Health checks fail

**Diagnosis:**
```bash
# Check if Bun is working
bun --version

# Try starting manually
bun run src/servers/http.ts

# Check for port conflicts
lsof -i :7000 :7001 :7002
```

**Solutions:**

1. **Bun Not Installed/Wrong Path:**
   ```bash
   # Install Bun
   curl -fsSL https://bun.sh/install | bash
   
   # Verify path
   export BUN_PATH=~/.bun/bin/bun
   ```

2. **Port Already in Use:**
   ```bash
   # Kill processes on conflicting ports
   lsof -ti:7000 | xargs kill -9
   lsof -ti:7001 | xargs kill -9
   lsof -ti:7002 | xargs kill -9
   
   # Or use different ports
HTTP_API_PORT=8000 MCP_HTTP_PORT=8001 LSP_SERVER_PORT=8002 just start
   ```

3. **Permission Issues:**
   ```bash
   # Fix directory permissions
   mkdir -p .ontology/logs .ontology/pids
   chmod 755 .ontology
   chmod 644 .ontology/logs/* 2>/dev/null || true
   ```

#### Server Starts But Health Checks Fail

**Symptoms:**
- PID files created
- Processes running but HTTP endpoints don't respond
- `curl: (7) Failed to connect`

**Diagnosis:**
```bash
# Check process status
ps aux | grep bun

# Check server logs
cat .ontology/logs/http-api.log
cat .ontology/logs/mcp-http.log

# Test direct connection
curl -v http://localhost:7000/health
```

**Solutions:**

1. **Server Crashed During Startup:**
   ```bash
   # Check crash logs
   grep -i "error\|exception\|crash" .ontology/logs/*.log
   
   # Start with debug logging
   DEBUG=* just start
   ```

2. **Database Initialization Failed:**
   ```bash
   # Remove corrupted database
   find .ontology -name "*.db*" -delete
   
   # Check database service
   bun run src/core/services/database-service.ts
   ```

3. **Configuration Error:**
   ```bash
   # Validate configuration
   bun run -e "
   import { getEnvironmentConfig, validatePorts } from './src/core/config/server-config.ts';
   const config = getEnvironmentConfig();
   validatePorts(config);
   console.log('Config valid:', config);
   "
   ```

### 2. Port Conflicts

#### Detecting Port Conflicts

```bash
# Check what's using LSP ports
netstat -tulpn | grep -E ':(7000|7001|7002)\s'

# Check with lsof (more detailed)
lsof -i :7000-7002

# Check for zombie processes
ps aux | grep -E '(bun|ontology)' | grep -v grep
```

#### Resolution Strategies

1. **Kill Conflicting Processes:**
   ```bash
   # Graceful shutdown
   just stop
   
   # Force kill if needed
   pkill -f "bun run src/servers"
   
   # Nuclear option
   lsof -ti:7000,7001,7002 | xargs kill -9
   ```

2. **Use Alternative Ports:**
   ```bash
   # Temporary port change
   export HTTP_API_PORT=8000
   export MCP_HTTP_PORT=8001
   export LSP_SERVER_PORT=8002
   just start
   
   # Permanent change in .env file
   echo "HTTP_API_PORT=8000" >> .env
   echo "MCP_HTTP_PORT=8001" >> .env
   echo "LSP_SERVER_PORT=8002" >> .env
   ```

### 3. Database Issues

#### Database Connection Failures

**Symptoms:**
- "SQLITE_CANTOPEN" errors
- "Database is locked" messages
- Learning system not persisting data

**Diagnosis:**
```bash
# Check database files
ls -la .ontology/db/

# Check for lock files
find .ontology -name "*.db-*" -o -name "*.lock"

# Test database connection
sqlite3 .ontology/db/ontology.sqlite "SELECT name FROM sqlite_master WHERE type='table';"
```

**Solutions:**

1. **Database Locked:**
   ```bash
   # Kill processes holding locks
   fuser .ontology/db/ontology.sqlite 2>/dev/null | xargs kill
   
   # Remove lock files
   rm -f .ontology/db/ontology.sqlite-wal .ontology/db/ontology.sqlite-shm
   ```

2. **Corrupted Database:**
   ```bash
   # Backup existing database
   cp .ontology/db/ontology.sqlite .ontology/db/ontology.sqlite.backup
   
   # Check integrity
   sqlite3 .ontology/db/ontology.sqlite "PRAGMA integrity_check;"
   
   # If corrupted, delete and reinitialize
   rm .ontology/db/ontology.sqlite
   just start  # Will recreate database
   ```

3. **Permission Issues:**
   ```bash
   # Fix database permissions
   chmod 644 .ontology/db/ontology.sqlite
   chmod 755 .ontology/db/
   
   # Ensure writable directory
   touch .ontology/db/test && rm .ontology/db/test
   ```

#### Schema Issues

**Symptoms:**
- "Column not found" errors
- Migration failures
- Inconsistent data

**Solutions:**
```bash
# Check current schema
sqlite3 .ontology/db/ontology.sqlite ".schema"

# Compare with expected schema
bun run -e "
import { DatabaseService } from './src/core/services/database-service.ts';
const db = new DatabaseService();
db.initialize();
"

# Reset database with correct schema
rm .ontology/db/ontology.sqlite
bun run src/core/services/database-service.ts
```

### 4. Memory and Performance Issues

#### High Memory Usage

**Symptoms:**
- System becomes slow
- Out of memory errors
- Large heap snapshots

**Diagnosis:**
```bash
# Monitor memory usage
watch -n 5 'ps aux | grep bun | grep -v grep | awk "{print \$2, \$4, \$6, \$11}"'

# Check V8 heap usage
node -e "console.log(process.memoryUsage())"

# Monitor with system tools
top -p $(pgrep -f "bun run src/servers")
```

**Solutions:**

1. **Clear Caches:**
   ```bash
   # Clear application caches
   rm -rf .ontology/cache/*
   
   # Restart with cache disabled
   LSP_CACHE_ENABLED=false just start
   ```

2. **Adjust Memory Limits:**
   ```bash
   # Start with more memory
   NODE_OPTIONS="--max-old-space-size=4096" just start
   
   # Or reduce cache size
   echo "LSP_CACHE_TTL=60000" >> .env  # 1 minute instead of 5
   ```

3. **Optimize Configuration:**
   ```bash
   # Reduce concurrent operations
   echo "MAX_CONCURRENT_REQUESTS=10" >> .env
   
   # Disable expensive features temporarily
   echo "PATTERN_LEARNING_ENABLED=false" >> .env
   ```

#### Slow Performance

**Diagnosis:**
```bash
# Run performance benchmarks
just test-performance

# Profile specific operations
DEBUG=performance just dev

# Check cache hit rates
curl -s http://localhost:7000/stats | jq '.cache'
```

**Solutions:**

1. **Warm Up Caches:**
   ```bash
   # Pre-warm caches
   bun run src/cli/analyze.ts --warm-cache
   ```

2. **Database Optimization:**
   ```bash
   # Optimize database
   sqlite3 .ontology/db/ontology.sqlite "VACUUM; ANALYZE;"
   
   # Check query performance
   sqlite3 .ontology/db/ontology.sqlite "EXPLAIN QUERY PLAN SELECT * FROM concepts LIMIT 1;"
   ```

### 5. Test Failures

#### Integration Tests Failing

**Common Test Failures:**

1. **Layer Registration Issues:**
   ```bash
   # Symptoms: "Layer not registered" errors
   # Fix: Update test helpers
   grep -r "layer1\|layer2" tests/ --include="*.test.ts"
   ```

2. **Cache Configuration Errors:**
   ```bash
   # Symptoms: "config.memory.maxSize" undefined
   # Fix: Update test configuration format
   grep -r "cache.maxSize" tests/ --include="*.test.ts"
   ```

3. **HTTP Response Format Issues:**
   ```bash
   # Symptoms: Expected array, got object
   # Fix: Check adapter response formatting
   curl -s http://localhost:7010/api/v1/find-definition | jq .
   ```

**General Test Debugging:**

```bash
# Run specific test file with verbose output
bun test tests/unified-core.test.ts --verbose

# Run tests in isolation
TEST_ISOLATION=true bun test tests/adapters.test.ts

# Check test environment
TEST_ENV=debug bun test tests/performance.test.ts
```

### 6. Protocol-Specific Issues

#### LSP Protocol Issues

**VS Code Extension Not Working:**

1. **Check Extension Installation:**
   ```bash
   code --list-extensions | grep ontology
   
   # Reinstall if needed
   just install-extension
   ```

2. **Check LSP Server:**
   ```bash
   # Test LSP server directly
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":"file:///tmp","capabilities":{}}}' | bun run src/servers/lsp.ts
   ```

3. **Check Extension Logs:**
   - Open VS Code
   - Go to Output panel
   - Select "Ontology Language Server" from dropdown

#### MCP Protocol Issues

**Claude Desktop Integration:**

1. **Check MCP Configuration:**
   ```bash
   # Verify config file
   cat claude-desktop-config.json
   
   # Test MCP server
   bun run dist/mcp/mcp.js
   ```

2. **Check MCP HTTP Connection:**
   ```bash
   # Test MCP HTTP health
   curl -N -H "Accept: text/event-stream" http://localhost:7001/events
   
   # Check tools endpoint
   curl -s http://localhost:7001/tools | jq .
   ```

#### HTTP API Issues

**REST API Problems:**

1. **CORS Errors:**
   ```bash
   # Test CORS headers
   curl -H "Origin: http://localhost:3000" \
        -H "Access-Control-Request-Method: GET" \
        -H "Access-Control-Request-Headers: X-Requested-With" \
        -X OPTIONS \
        http://localhost:7000/api/v1/health
   ```

2. **Route Not Found:**
   ```bash
   # List all available routes
   curl -s http://localhost:7000/api/v1/ | jq .
   
   # Check specific endpoint
   curl -v http://localhost:7000/api/v1/find-definition
   ```

## 🛠 Advanced Debugging Procedures

### Debug Mode

Enable comprehensive debugging:

```bash
# Full debug mode
DEBUG=* just dev

# Specific debug categories
DEBUG=ontology:* just dev
DEBUG=performance:* just dev
DEBUG=database:* just dev

# Debug with profiling
NODE_OPTIONS="--prof --prof-process" DEBUG=* just dev
```

### Production Debugging

For production issues:

```bash
# Check deployment health
kubectl get pods -n ontology-lsp
kubectl logs -f deployment/ontology-lsp -n ontology-lsp

# Port forward for debugging
kubectl port-forward svc/ontology-lsp-http 7000:7000 -n ontology-lsp

# Check resource usage
kubectl top pods -n ontology-lsp

# Dump configuration
kubectl get configmap ontology-lsp-config -o yaml -n ontology-lsp
```

### Performance Profiling

```bash
# CPU profiling
node --prof --prof-process src/servers/http.ts

# Memory profiling
node --inspect --inspect-brk src/servers/http.ts

# Flame graphs (if clinic.js installed)
clinic flame -- bun run src/servers/http.ts
```

## 🔄 Recovery Procedures

### Complete System Reset

When everything is broken:

```bash
# 1. Stop all processes
just stop
pkill -f ontology
pkill -f bun

# 2. Clean everything
rm -rf .ontology/
rm -rf node_modules/
rm -f bun.lockb

# 3. Reinstall
bun install

# 4. Initialize fresh
just init

# 5. Start clean
just start
```

### Backup and Restore

**Backup Important Data:**
```bash
# Create backup
mkdir -p backups/$(date +%Y%m%d-%H%M%S)
cp -r .ontology/db/ backups/$(date +%Y%m%d-%H%M%S)/
cp .env backups/$(date +%Y%m%d-%H%M%S)/ 2>/dev/null || true

# Automated backup script
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r .ontology/db/ "$BACKUP_DIR/"
cp .env "$BACKUP_DIR/" 2>/dev/null || true
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR/"
rm -rf "$BACKUP_DIR"
echo "Backup created: $BACKUP_DIR.tar.gz"
EOF
chmod +x backup.sh
```

**Restore from Backup:**
```bash
# List backups
ls -la backups/

# Restore specific backup
tar -xzf backups/20240824-143000.tar.gz
cp -r 20240824-143000/db/ .ontology/
cp 20240824-143000/.env . 2>/dev/null || true
```

### Database Recovery

**Recover from Database Corruption:**
```bash
# 1. Stop services
just stop

# 2. Backup corrupted database
cp .ontology/db/ontology.sqlite .ontology/db/corrupted-$(date +%s).sqlite

# 3. Try repair
sqlite3 .ontology/db/ontology.sqlite "PRAGMA integrity_check;"

# 4. If repair fails, rebuild from scratch
rm .ontology/db/ontology.sqlite
bun run src/core/services/database-service.ts

# 5. Re-analyze codebase to rebuild knowledge
just analyze
```

## 📊 Monitoring and Health Checks

### Automated Health Monitoring

Create a health check script:

```bash
cat > health-monitor.sh << 'EOF'
#!/bin/bash

check_service() {
    local service=$1
    local port=$2
    local name=$3
    
    if curl -s "http://localhost:$port/health" >/dev/null 2>&1; then
        echo "✅ $name ($service:$port): HEALTHY"
        return 0
    else
        echo "❌ $name ($service:$port): UNHEALTHY"
        return 1
    fi
}

echo "🩺 Health Check Report - $(date)"
echo "================================"

failed=0

check_service "http" "7000" "HTTP API" || ((failed++))
check_service "mcp" "7001" "MCP HTTP" || ((failed++))

# Check processes
if pgrep -f "bun run src/servers" >/dev/null; then
    echo "✅ Server processes: RUNNING"
else
    echo "❌ Server processes: NOT RUNNING"
    ((failed++))
fi

# Check disk space
disk_usage=$(df -h .ontology | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$disk_usage" -lt 90 ]; then
    echo "✅ Disk usage: ${disk_usage}%"
else
    echo "⚠️  Disk usage: ${disk_usage}% (HIGH)"
    ((failed++))
fi

# Check memory usage
mem_usage=$(free | grep Mem | awk '{printf "%.0f", ($3/$2)*100}')
if [ "$mem_usage" -lt 90 ]; then
    echo "✅ Memory usage: ${mem_usage}%"
else
    echo "⚠️  Memory usage: ${mem_usage}% (HIGH)"
fi

echo "================================"
if [ $failed -eq 0 ]; then
    echo "🎉 All systems operational"
    exit 0
else
    echo "🚨 $failed systems need attention"
    exit 1
fi
EOF

chmod +x health-monitor.sh

# Run health check
./health-monitor.sh
```

### Log Analysis

Automated log analysis:

```bash
cat > analyze-logs.sh << 'EOF'
#!/bin/bash

echo "📊 Log Analysis Report - $(date)"
echo "================================"

for log in .ontology/logs/*.log; do
    if [ -f "$log" ]; then
        echo ""
        echo "📁 $(basename "$log"):"
        echo "  Lines: $(wc -l < "$log")"
        echo "  Size: $(du -h "$log" | cut -f1)"
        
        error_count=$(grep -i error "$log" | wc -l)
        warn_count=$(grep -i warn "$log" | wc -l)
        
        echo "  Errors: $error_count"
        echo "  Warnings: $warn_count"
        
        if [ $error_count -gt 0 ]; then
            echo "  Recent errors:"
            grep -i error "$log" | tail -3 | sed 's/^/    /'
        fi
    fi
done

echo ""
echo "🔍 Common Error Patterns:"
grep -h -i "error\|exception\|crash\|fail" .ontology/logs/*.log 2>/dev/null | \
    sort | uniq -c | sort -nr | head -5 | sed 's/^/  /'

EOF

chmod +x analyze-logs.sh
```

## 🆘 Getting Support

### Information to Collect Before Reporting Issues

Run this diagnostic script and include the output:

```bash
cat > collect-diagnostics.sh << 'EOF'
#!/bin/bash

echo "🔍 Ontology-LSP Diagnostic Report"
echo "================================"
echo "Date: $(date)"
echo "System: $(uname -a)"
echo ""

echo "📦 Environment:"
echo "  Bun version: $(bun --version 2>/dev/null || echo 'Not installed')"
echo "  Node version: $(node --version 2>/dev/null || echo 'Not installed')"
echo "  Platform: $OSTYPE"
echo ""

echo "🏗️ Build Info:"
echo "  Project directory: $(pwd)"
echo "  Git commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'Not a git repo')"
echo "  Git branch: $(git branch --show-current 2>/dev/null || echo 'Not a git repo')"
echo ""

echo "🔧 Configuration:"
echo "  Config validation:"
bun run -e "
try {
  const { getEnvironmentConfig } = require('./src/core/config/server-config.ts');
  console.log('  ✅ Configuration valid');
} catch (e) {
  console.log('  ❌ Configuration error:', e.message);
}
" 2>/dev/null || echo "  ❌ Cannot load configuration"

echo ""
echo "💾 Storage:"
echo "  Database exists: $([ -f .ontology/db/ontology.sqlite ] && echo 'Yes' || echo 'No')"
echo "  Database size: $(du -h .ontology/db/ontology.sqlite 2>/dev/null | cut -f1 || echo 'N/A')"
echo "  Cache directory: $(du -sh .ontology/cache 2>/dev/null | cut -f1 || echo 'N/A')"
echo ""

echo "🚀 Processes:"
ps aux | grep -E "(bun|ontology)" | grep -v grep | sed 's/^/  /'
echo ""

echo "🌐 Network:"
echo "  Port 7000: $(lsof -i :7000 >/dev/null 2>&1 && echo 'In use' || echo 'Available')"
echo "  Port 7001: $(lsof -i :7001 >/dev/null 2>&1 && echo 'In use' || echo 'Available')"
echo "  Port 7002: $(lsof -i :7002 >/dev/null 2>&1 && echo 'In use' || echo 'Available')"
echo ""

echo "📋 Recent logs (last 10 lines):"
for log in .ontology/logs/*.log; do
    if [ -f "$log" ]; then
        echo "  📁 $(basename "$log"):"
        tail -10 "$log" 2>/dev/null | sed 's/^/    /' || echo "    (cannot read log)"
        echo ""
    fi
done

echo "❌ Recent errors:"
grep -h -i "error\|exception" .ontology/logs/*.log 2>/dev/null | tail -5 | sed 's/^/  /' || echo "  No recent errors found"

EOF

chmod +x collect-diagnostics.sh

# Run diagnostics
./collect-diagnostics.sh
```

### Support Channels

1. **GitHub Issues**: https://github.com/your-username/ontology-lsp/issues
   - Include diagnostic output
   - Specify version and environment
   - Provide minimal reproduction steps

2. **Community Support**:
   - Check existing documentation in `docs/`
   - Review FAQ at `docs/FAQ.md`
   - Search closed issues for solutions

3. **Emergency Contact**:
   - For production-critical issues
   - Include full diagnostic report
   - Specify impact and urgency level

### Self-Help Resources

1. **Built-in Help**:
   ```bash
   just --list              # All available commands
   bun run src/cli/help.ts  # CLI help system
   ```

2. **Documentation**:
   - `README.md` - Basic setup and usage
   - `VISION.md` - System architecture
   - `PROJECT_STATUS.md` - Current implementation status
   - `API_SPECIFICATION.md` - API documentation

3. **Debugging Tools**:
   ```bash
   just status       # Server status
   just health       # Health checks
   just logs         # Real-time logs
   just test-all     # Comprehensive testing
   ```

---

## 📚 Additional Resources

- **Architecture Overview**: See `VISION.md` for system design
- **Development Guide**: See `CLAUDE.md` for development workflow
- **API Reference**: See `API_SPECIFICATION.md` for endpoint documentation
- **Testing Guide**: See `TESTING_STRATEGY.md` for testing approaches
- **Deployment Guide**: See `DEPLOYMENT.md` for production setup

Remember: Most issues can be resolved by following the quick diagnostic checklist and common solutions above. When in doubt, try the complete system reset procedure to start fresh.
