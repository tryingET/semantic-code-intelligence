import { describe, expect, test } from 'bun:test';
import {
    isLoopbackHost,
    isLoopbackOrigin,
    resolveMcpHttpCorsOrigin,
    type McpHttpCorsOrigin,
} from '../src/servers/mcp-http-cors';

function assertCorsCallback(
    policy: McpHttpCorsOrigin
): asserts policy is Exclude<McpHttpCorsOrigin, boolean | string | string[]> {
    expect(typeof policy).toBe('function');
}

function evaluateCorsPolicy(
    policy: Exclude<McpHttpCorsOrigin, boolean | string | string[]>,
    origin: string | undefined
) {
    let result: boolean | string | string[] | undefined;
    let error: Error | null | undefined;
    policy(origin, (err, allow) => {
        error = err;
        result = allow;
    });
    expect(error).toBeNull();
    return result;
}

describe('MCP HTTP CORS policy', () => {
    test('keeps localhost browser origins permissive by default', () => {
        const policy = resolveMcpHttpCorsOrigin('localhost', '');
        assertCorsCallback(policy);

        expect(evaluateCorsPolicy(policy, undefined)).toBe(true);
        expect(evaluateCorsPolicy(policy, 'http://localhost:7001')).toBe(true);
        expect(evaluateCorsPolicy(policy, 'http://127.0.0.1:7001')).toBe(true);
        expect(evaluateCorsPolicy(policy, 'http://[::1]:7001')).toBe(true);
    });

    test('rejects non-loopback browser origins even when bound to loopback', () => {
        const policy = resolveMcpHttpCorsOrigin('localhost', '');
        assertCorsCallback(policy);

        expect(evaluateCorsPolicy(policy, 'https://client.example.test')).toBe(false);
        expect(evaluateCorsPolicy(policy, 'http://192.168.1.10:7001')).toBe(false);
        expect(evaluateCorsPolicy(policy, 'not a url')).toBe(false);
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

    test('detects normalized loopback hosts and origins', () => {
        expect(isLoopbackHost('LOCALHOST')).toBe(true);
        expect(isLoopbackHost('[::1]')).toBe(true);
        expect(isLoopbackHost('0.0.0.0')).toBe(false);
        expect(isLoopbackOrigin('http://localhost:7001')).toBe(true);
        expect(isLoopbackOrigin('https://client.example.test')).toBe(false);
    });
});
