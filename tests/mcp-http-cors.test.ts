import { describe, expect, test } from 'bun:test';
import { isLoopbackHost, resolveMcpHttpCorsOrigin } from '../src/servers/mcp-http-cors';

describe('MCP HTTP CORS policy', () => {
    test('keeps localhost development origins permissive by default', () => {
        expect(resolveMcpHttpCorsOrigin('localhost', '')).toBe('*');
        expect(resolveMcpHttpCorsOrigin('127.0.0.1', '')).toBe('*');
        expect(resolveMcpHttpCorsOrigin('[::1]', '')).toBe('*');
    });

    test('fails closed for externally bound hosts unless explicitly configured', () => {
        expect(resolveMcpHttpCorsOrigin('0.0.0.0', '')).toBe(false);
        expect(resolveMcpHttpCorsOrigin('192.168.1.10', '')).toBe(false);
        expect(resolveMcpHttpCorsOrigin('mcp.example.test', '')).toBe(false);
    });

    test('accepts explicit MCP HTTP CORS origin settings', () => {
        expect(resolveMcpHttpCorsOrigin('0.0.0.0', '*')).toBe('*');
        expect(resolveMcpHttpCorsOrigin('0.0.0.0', 'https://client.example.test')).toBe('https://client.example.test');
        expect(resolveMcpHttpCorsOrigin('0.0.0.0', 'https://a.example.test, https://b.example.test')).toEqual([
            'https://a.example.test',
            'https://b.example.test',
        ]);
    });

    test('supports explicit CORS disable sentinels', () => {
        expect(resolveMcpHttpCorsOrigin('localhost', 'false')).toBe(false);
        expect(resolveMcpHttpCorsOrigin('localhost', '0')).toBe(false);
        expect(resolveMcpHttpCorsOrigin('localhost', 'none')).toBe(false);
    });

    test('detects normalized loopback hosts', () => {
        expect(isLoopbackHost('LOCALHOST')).toBe(true);
        expect(isLoopbackHost('[::1]')).toBe(true);
        expect(isLoopbackHost('0.0.0.0')).toBe(false);
    });
});
