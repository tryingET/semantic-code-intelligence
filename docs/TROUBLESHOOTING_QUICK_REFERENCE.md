# Troubleshooting Quick Reference

This is a condensed reference for common troubleshooting commands. For complete documentation, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 🚨 Emergency Commands

```bash
# Stop everything and clean state
just emergency-reset

# Quick diagnostic check
just health-check

# Full diagnostic report
just diagnostics
```

## 🔧 Common Issues

### Servers Won't Start

```bash
# Check what's running
just status

# Check for port conflicts  
lsof -i :7000-7002

# Force stop and restart
just stop
lsof -ti:7000,7001,7002 | xargs kill -9
just start
```

### Database Issues

```bash
# Remove corrupted database
rm -f .ontology/db/ontology.sqlite
just start

# Check database status  
sqlite3 .ontology/db/ontology.sqlite "PRAGMA integrity_check;"
```

### Performance Problems

```bash
# Check system resources
free -h
df -h .ontology

# Analyze logs for errors
just analyze-logs

# Disable cache temporarily
LSP_CACHE_ENABLED=false just start
```

## 📊 Diagnostic Commands

| Command | Description |
|---------|-------------|
| `just health-check` | System health overview |
| `just analyze-logs` | Log analysis and error detection |
| `just diagnostics` | Complete system diagnostic |
| `just save-diagnostics` | Save diagnostic report to file |
| `just test-diagnostics` | Test all diagnostic tools |

## 💾 Backup Commands

| Command | Description |
|---------|-------------|
| `just backup` | Create system backup |
| `just list-backups` | List available backups |
| `just restore-backup <name>` | Restore from backup |
| `just clean-backups` | Remove old backups |

## 📋 Note on Commands

**All diagnostic functionality is now integrated directly into the justfile.**

There are no external scripts needed - everything is self-contained in justfile recipes for better maintainability and discoverability.

Use `just --list` to see all available commands.

## 🔍 Quick Checks

```bash
# Check configuration
bun run -e "
const { getEnvironmentConfig } = require('./src/core/config/server-config.ts');
console.log(getEnvironmentConfig());
"

# Check processes
ps aux | grep bun

# Check ports
netstat -tulpn | grep -E ':(7000|7001|7002)'

# Check logs
tail -f .ontology/logs/*.log

# Check disk space  
df -h .ontology
```

## 🆘 When to Get Help

Include diagnostic output when reporting issues:

```bash
# Collect diagnostics
just save-diagnostics

# The report includes:
# - Environment information
# - Configuration status
# - Process information
# - Network connectivity
# - Recent logs and errors
# - System resources
```

## 📖 Documentation Links

- [Complete Troubleshooting Guide](TROUBLESHOOTING.md)
- [System Architecture](../VISION.md)
- [Project Status](../PROJECT_STATUS.md)
- [Development Guide](../CLAUDE.md)