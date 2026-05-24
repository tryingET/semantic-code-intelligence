export type McpHttpCorsOrigin = boolean | string | string[];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

function normalizeHost(host: string | undefined): string {
    return (host || 'localhost').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

export function isLoopbackHost(host: string | undefined): boolean {
    return LOOPBACK_HOSTS.has(normalizeHost(host));
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

    return isLoopbackHost(host) ? '*' : false;
}
