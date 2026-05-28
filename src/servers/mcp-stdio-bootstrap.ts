// Stdio protocol guard must run before MCP server dependencies are evaluated.
// Keep this module side-effect-only and import it first from src/servers/mcp.ts.
process.env.SILENT_MODE = 'true';
process.env.STDIO_MODE = 'true';

if (process.env.STDIO_MODE) {
    console.log = (...args: unknown[]) => {
        if (process.env.DEBUG || process.env.DEBUG_STDIO_LOGS) {
            process.stderr.write(`[LOG] ${args.map(String).join(' ')}\n`);
        }
    };
    console.info = (...args: unknown[]) => {
        if (process.env.DEBUG || process.env.DEBUG_STDIO_LOGS) {
            process.stderr.write(`[INFO] ${args.map(String).join(' ')}\n`);
        }
    };
    console.warn = (...args: unknown[]) => {
        if (process.env.DEBUG || process.env.DEBUG_STDIO_LOGS) {
            process.stderr.write(`[WARN] ${args.map(String).join(' ')}\n`);
        }
    };
}
