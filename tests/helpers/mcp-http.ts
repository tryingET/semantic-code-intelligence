export const MCP_PROTOCOL_VERSION = '2024-11-05';

export function mcpHttpHeaders(sessionId?: string): HeadersInit {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        'Mcp-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    if (sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
    }
    return headers;
}

export async function initMcpHttpSession(
    base: string,
    clientInfo: { name: string; version: string } = { name: 'test', version: '1.0.0' }
): Promise<string> {
    const init = await fetch(base, {
        method: 'POST',
        headers: mcpHttpHeaders(),
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo,
            },
        }),
    });
    const sid = init.headers.get('Mcp-Session-Id');
    if (!sid) {
        throw new Error('Missing Mcp-Session-Id');
    }

    await fetch(base, {
        method: 'POST',
        headers: mcpHttpHeaders(String(sid)),
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {},
        }),
    });

    return String(sid);
}
