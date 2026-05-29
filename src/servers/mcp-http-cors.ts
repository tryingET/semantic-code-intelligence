export type McpHttpCorsOrigin =
    | boolean
    | string
    | string[]
    | ((
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean | string | string[]) => void
      ) => void);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

function normalizeHost(host: string | undefined): string {
    return (host || 'localhost').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function originHost(origin: string): string | null {
    try {
        return normalizeHost(new URL(origin).hostname);
    } catch {
        return null;
    }
}

export function isLoopbackHost(host: string | undefined): boolean {
    return LOOPBACK_HOSTS.has(normalizeHost(host));
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    const host = originHost(origin);
    return host ? isLoopbackHost(host) : false;
}

function loopbackOnlyCorsOrigin(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
): void {
    callback(null, isLoopbackOrigin(origin));
}

export function resolveMcpHttpCorsOrigin(
    host: string | undefined,
    configuredOrigin: string | undefined = process.env.MCP_HTTP_CORS_ORIGIN
): McpHttpCorsOrigin {
    const configured = configuredOrigin?.trim();
    if (configured) {
        const lowered = configured.toLowerCase();
        if (lowered === 'false' || lowered === '0' || lowered === 'none') return false;
        if (configured === '*') return '*';

        const origins = configured
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);

        if (origins.length === 0) return false;
        return origins.length === 1 ? origins[0] : origins;
    }

    return isLoopbackHost(host) ? loopbackOnlyCorsOrigin : false;
}
