/**
 * Logger utility that respects stdio protocol requirements
 *
 * When running in stdio mode (like MCP servers), all logging MUST go to stderr
 * to keep stdout clean for protocol messages.
 */

const isStdioMode =
    process.env.STDIO_MODE === 'true' ||
    process.argv.includes('--stdio') ||
    // Detect if running as MCP server
    process.argv.some((arg) => arg.includes('mcp.ts'));

const isSilentMode = process.env.SILENT_MODE === 'true' || process.env.NODE_ENV === 'test';

export const logger = {
    log: (message: string, ...args: any[]) => {
        if (isSilentMode) return;
        if (isStdioMode) {
            // In stdio mode, ALL logs go to stderr
            console.error(message, ...args);
        } else {
            console.log(message, ...args);
        }
    },

    error: (message: string, ...args: any[]) => {
        if (isSilentMode && !message.toLowerCase().includes('error')) return;
        console.error(message, ...args);
    },

    warn: (message: string, ...args: any[]) => {
        if (isSilentMode) return;
        if (isStdioMode) {
            console.error(`[WARN] ${message}`, ...args);
        } else {
            console.warn(message, ...args);
        }
    },

    info: (message: string, ...args: any[]) => {
        if (isSilentMode) return;
        if (isStdioMode) {
            console.error(`[INFO] ${message}`, ...args);
        } else {
            console.info(message, ...args);
        }
    },

    debug: (message: string, ...args: any[]) => {
        if (isSilentMode) return;
        if (process.env.DEBUG || process.env.VERBOSE) {
            if (isStdioMode) {
                console.error(`[DEBUG] ${message}`, ...args);
            } else {
                console.log(`[DEBUG] ${message}`, ...args);
            }
        }
    },
};

// Export a helper to temporarily suppress logging
export function withSilentLogging<T>(fn: () => T): T {
    const originalSilent = process.env.SILENT_MODE;
    process.env.SILENT_MODE = 'true';
    try {
        return fn();
    } finally {
        if (originalSilent === undefined) {
            delete process.env.SILENT_MODE;
        } else {
            process.env.SILENT_MODE = originalSilent;
        }
    }
}
