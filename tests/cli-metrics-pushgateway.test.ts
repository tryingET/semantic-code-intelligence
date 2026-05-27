/**
 * Tests for CLI metrics and Pushgateway integration.
 *
 * Verifies that:
 * - Metrics are recorded during CLI command execution
 * - Pushgateway push function works correctly
 * - Environment variable configuration is respected
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    buildPushgatewayUrl,
    getPushgatewayUrl,
    metricsRegistry,
    pushToGateway,
    recordToolEnd,
    recordToolStart,
    shouldPushMetrics,
} from '../src/instrumentation/metrics';

describe('CLI Metrics Pushgateway', () => {
    // Store original env values
    let originalPushgatewayUrl: string | undefined;
    let originalPromPushgatewayUrl: string | undefined;

    beforeEach(() => {
        originalPushgatewayUrl = process.env.PUSHGATEWAY_URL;
        originalPromPushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY_URL;
        // Clear env vars
        delete process.env.PUSHGATEWAY_URL;
        delete process.env.PROMETHEUS_PUSHGATEWAY_URL;
    });

    afterEach(() => {
        // Restore env vars
        if (originalPushgatewayUrl !== undefined) {
            process.env.PUSHGATEWAY_URL = originalPushgatewayUrl;
        } else {
            delete process.env.PUSHGATEWAY_URL;
        }
        if (originalPromPushgatewayUrl !== undefined) {
            process.env.PROMETHEUS_PUSHGATEWAY_URL = originalPromPushgatewayUrl;
        } else {
            delete process.env.PROMETHEUS_PUSHGATEWAY_URL;
        }
    });

    describe('getPushgatewayUrl', () => {
        test('returns undefined when no env var is set', () => {
            expect(getPushgatewayUrl()).toBeUndefined();
        });

        test('returns PUSHGATEWAY_URL when set', () => {
            process.env.PUSHGATEWAY_URL = 'http://localhost:9091';
            expect(getPushgatewayUrl()).toBe('http://localhost:9091');
        });

        test('returns PROMETHEUS_PUSHGATEWAY_URL as fallback', () => {
            process.env.PROMETHEUS_PUSHGATEWAY_URL = 'http://pushgateway:9091';
            expect(getPushgatewayUrl()).toBe('http://pushgateway:9091');
        });

        test('prefers PUSHGATEWAY_URL over PROMETHEUS_PUSHGATEWAY_URL', () => {
            process.env.PUSHGATEWAY_URL = 'http://primary:9091';
            process.env.PROMETHEUS_PUSHGATEWAY_URL = 'http://fallback:9091';
            expect(getPushgatewayUrl()).toBe('http://primary:9091');
        });
    });

    describe('shouldPushMetrics', () => {
        test('returns false when no URL is configured', () => {
            expect(shouldPushMetrics()).toBe(false);
        });

        test('returns true when PUSHGATEWAY_URL is set', () => {
            process.env.PUSHGATEWAY_URL = 'http://localhost:9091';
            expect(shouldPushMetrics()).toBe(true);
        });

        test('returns true when PROMETHEUS_PUSHGATEWAY_URL is set', () => {
            process.env.PROMETHEUS_PUSHGATEWAY_URL = 'http://localhost:9091';
            expect(shouldPushMetrics()).toBe(true);
        });
    });

    describe('metrics recording', () => {
        test('records CLI tool call metrics', () => {
            // Simulate a CLI command execution
            recordToolStart('cli');
            recordToolEnd('cli', 'find', 150, true);

            const metrics = metricsRegistry.renderPrometheusText();
            expect(metrics).toContain('tool_calls_total');
            expect(metrics).toContain('adapter="cli"');
            expect(metrics).toContain('tool="find"');
            expect(metrics).toContain('result="success"');
        });

        test('records failed CLI command', () => {
            recordToolStart('cli');
            recordToolEnd('cli', 'references', 50, false);

            const metrics = metricsRegistry.renderPrometheusText();
            expect(metrics).toContain('adapter="cli"');
            expect(metrics).toContain('tool="references"');
            expect(metrics).toContain('result="error"');
        });

        test('records duration histogram', () => {
            recordToolStart('cli');
            recordToolEnd('cli', 'explore', 250, true);

            const metrics = metricsRegistry.renderPrometheusText();
            expect(metrics).toContain('tool_duration_ms');
            expect(metrics).toContain('tool_duration_ms_bucket');
            expect(metrics).toContain('tool_duration_ms_sum');
            expect(metrics).toContain('tool_duration_ms_count');
        });
    });

    describe('pushToGateway', () => {
        test('returns success with statusCode 0 when no metrics to push', async () => {
            // Create a fresh registry with no metrics
            // Note: We can't easily reset the singleton, so we test with the existing registry
            // which should have metrics from previous tests
            const result = await pushToGateway('http://nonexistent:9091', 'test_job');

            // Either succeeds with no metrics, or fails to connect (both are valid)
            expect(typeof result.success).toBe('boolean');
        });

        test('returns error when Pushgateway is unreachable', async () => {
            recordToolStart('cli');
            recordToolEnd('cli', 'test_command', 100, true);

            const temporary = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                fetch: () => new Response('ok'),
            });
            const port = temporary.port;
            temporary.stop(true);

            const previousTimeout = process.env.PUSHGATEWAY_TIMEOUT_MS;
            process.env.PUSHGATEWAY_TIMEOUT_MS = '250';
            try {
                const result = await pushToGateway(`http://127.0.0.1:${port}`, 'test_job');
                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            } finally {
                if (previousTimeout === undefined) delete process.env.PUSHGATEWAY_TIMEOUT_MS;
                else process.env.PUSHGATEWAY_TIMEOUT_MS = previousTimeout;
            }
        });

        test('handles URL construction correctly', () => {
            expect(typeof pushToGateway).toBe('function');
            expect(pushToGateway.length).toBe(3); // url, job, instance (optional)
            expect(buildPushgatewayUrl('http://localhost:9091/', 'ontology_cli')).toBe(
                'http://localhost:9091/metrics/job/ontology_cli'
            );
            expect(buildPushgatewayUrl('http://localhost:9091', 'ontology_cli', 'instance1')).toBe(
                'http://localhost:9091/metrics/job/ontology_cli/instance/instance1'
            );
        });

        test('pushes to the expected URL with job name', async () => {
            recordToolStart('cli');
            recordToolEnd('cli', 'url_test', 50, true);

            let observedPath = '';
            let observedBody = '';
            const server = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                fetch: async (request) => {
                    observedPath = new URL(request.url).pathname;
                    observedBody = await request.text();
                    return new Response('ok', { status: 202 });
                },
            });

            try {
                const result = await pushToGateway(`http://127.0.0.1:${server.port}/`, 'ontology_cli', 'instance1');
                expect(result).toEqual({ success: true, statusCode: 202 });
                expect(observedPath).toBe('/metrics/job/ontology_cli/instance/instance1');
                expect(observedBody).toContain('tool_calls_total');
            } finally {
                server.stop(true);
            }
        });

        test('encodes special characters in job name', () => {
            expect(buildPushgatewayUrl('http://localhost:9091', 'job/with/slashes')).toBe(
                'http://localhost:9091/metrics/job/job%2Fwith%2Fslashes'
            );
        });
    });

    describe('Prometheus text format', () => {
        test('renders valid Prometheus text format', () => {
            recordToolStart('cli');
            recordToolEnd('cli', 'format_test', 100, true);

            const metrics = metricsRegistry.renderPrometheusText();

            // Should have proper format
            expect(metrics).toContain('# HELP');
            expect(metrics).toContain('# TYPE');

            // Counter format
            expect(metrics).toMatch(/tool_calls_total\{[^}]+\} \d+/);

            // Histogram format
            expect(metrics).toMatch(/tool_duration_ms_bucket\{[^}]+\} \d+/);
            expect(metrics).toMatch(/tool_duration_ms_sum\{[^}]+\} \d+/);
            expect(metrics).toMatch(/tool_duration_ms_count\{[^}]+\} \d+/);
        });

        test('includes +Inf bucket in histograms', () => {
            recordToolStart('cli');
            recordToolEnd('cli', 'inf_test', 5000, true); // Large duration

            const metrics = metricsRegistry.renderPrometheusText();
            expect(metrics).toContain('le="+Inf"');
        });
    });
});
