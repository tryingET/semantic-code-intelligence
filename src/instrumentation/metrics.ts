// Lightweight Prometheus-style metrics registry (adapter-agnostic)
// Phase 1: in-process counters/histograms with bounded labels

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

class Counter {
    private map = new Map<string, number>();
    inc(labels: Labels, value = 1): void {
        const key = labelKey(labels);
        this.map.set(key, (this.map.get(key) || 0) + value);
    }
    entries(): Array<{ labels: Labels; value: number }> {
        const out: Array<{ labels: Labels; value: number }> = [];
        for (const [k, v] of this.map.entries()) {
            const labels: Labels = {};
            for (const part of k.split(',')) {
                if (!part) continue;
                const [lk, lv] = part.split('=');
                labels[lk] = lv;
            }
            out.push({ labels, value: v });
        }
        return out;
    }
}

class Histogram {
    private buckets: number[];
    private map = new Map<string, { counts: number[]; sum: number; count: number }>();
    constructor(buckets: number[]) {
        // ensure sorted, unique
        this.buckets = Array.from(new Set(buckets)).sort((a, b) => a - b);
    }
    observe(labels: Labels, value: number): void {
        const key = labelKey(labels);
        let rec = this.map.get(key);
        if (!rec) {
            rec = { counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
            this.map.set(key, rec);
        }
        rec.sum += value;
        rec.count += 1;
        for (let i = 0; i < this.buckets.length; i++) {
            if (value <= this.buckets[i]) {
                rec.counts[i] += 1;
                break;
            }
        }
    }
    snapshots(): Array<{ labels: Labels; counts: number[]; sum: number; count: number }> {
        const out: Array<{ labels: Labels; counts: number[]; sum: number; count: number }> = [];
        for (const [k, v] of this.map.entries()) {
            const labels: Labels = {};
            for (const part of k.split(',')) {
                if (!part) continue;
                const [lk, lv] = part.split('=');
                labels[lk] = lv;
            }
            out.push({ labels, counts: v.counts.slice(), sum: v.sum, count: v.count });
        }
        return out;
    }
    getBuckets(): number[] {
        return this.buckets;
    }
}

class Gauge {
    private map = new Map<string, number>();
    set(labels: Labels, value: number): void {
        this.map.set(labelKey(labels), value);
    }
    inc(labels: Labels, value = 1): void {
        const key = labelKey(labels);
        this.map.set(key, (this.map.get(key) || 0) + value);
    }
    dec(labels: Labels, value = 1): void {
        const key = labelKey(labels);
        this.map.set(key, Math.max(0, (this.map.get(key) || 0) - value));
    }
    entries(): Array<{ labels: Labels; value: number }> {
        const out: Array<{ labels: Labels; value: number }> = [];
        for (const [k, v] of this.map.entries()) {
            const labels: Labels = {};
            for (const part of k.split(',')) {
                if (!part) continue;
                const [lk, lv] = part.split('=');
                labels[lk] = lv;
            }
            out.push({ labels, value: v });
        }
        return out;
    }
}

export class MetricsRegistry {
    readonly toolCalls = new Counter();
    readonly errors = new Counter();
    readonly toolDurationMs = new Histogram([5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
    readonly layerLatencyMs = new Histogram([1, 5, 10, 20, 50, 100, 200]);
    readonly inflightRequests = new Gauge();

    private normLabel(v: string): string {
        return String(v || '').replace(/[^a-zA-Z0-9_:\-.]/g, '_');
    }

    recordToolStart(adapter: string): void {
        this.inflightRequests.inc({ adapter: this.normLabel(adapter) });
    }

    recordToolEnd(adapter: string, tool: string, durationMs: number, success: boolean): void {
        const a = this.normLabel(adapter);
        const t = this.normLabel(tool);
        this.inflightRequests.dec({ adapter: a });
        this.toolCalls.inc({ adapter: a, tool: t, result: success ? 'success' : 'error' });
        this.toolDurationMs.observe({ adapter: a, tool: t }, Math.max(0, Math.floor(durationMs)));
    }

    recordError(adapter: string, errorCode: string): void {
        this.errors.inc({ adapter: this.normLabel(adapter), error_code: this.normLabel(errorCode) });
    }

    recordLayerLatency(adapter: string, layer: string, durationMs: number): void {
        this.layerLatencyMs.observe(
            { adapter: this.normLabel(adapter), layer: this.normLabel(layer) },
            Math.max(0, Math.floor(durationMs))
        );
    }

    renderPrometheusText(): string {
        const lines: string[] = [];
        // Counters
        lines.push('# HELP tool_calls_total Total tool calls by adapter/tool/result.');
        lines.push('# TYPE tool_calls_total counter');
        for (const { labels, value } of this.toolCalls.entries()) {
            const lbl = Object.entries(labels)
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`tool_calls_total{${lbl}} ${value}`);
        }
        lines.push('# HELP errors_total Total errors by adapter and code.');
        lines.push('# TYPE errors_total counter');
        for (const { labels, value } of this.errors.entries()) {
            const lbl = Object.entries(labels)
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`errors_total{${lbl}} ${value}`);
        }

        // Histograms: tool_duration_ms
        const tb = this.toolDurationMs.getBuckets();
        lines.push('# HELP tool_duration_ms Tool duration histogram (ms).');
        lines.push('# TYPE tool_duration_ms histogram');
        for (const s of this.toolDurationMs.snapshots()) {
            let cum = 0;
            for (let i = 0; i < tb.length; i++) {
                cum += s.counts[i] || 0;
                const lbl = Object.entries({ ...s.labels, le: String(tb[i]) })
                    .map(([k, v]) => `${k}="${v}` + '"')
                    .join(',');
                lines.push(`tool_duration_ms_bucket{${lbl}} ${cum}`);
            }
            const lblInf = Object.entries({ ...s.labels, le: '+Inf' })
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`tool_duration_ms_bucket{${lblInf}} ${s.count}`);
            const lbl = Object.entries(s.labels)
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`tool_duration_ms_sum{${lbl}} ${s.sum}`);
            lines.push(`tool_duration_ms_count{${lbl}} ${s.count}`);
        }

        // Histograms: layer_latency_ms
        const lb = this.layerLatencyMs.getBuckets();
        lines.push('# HELP layer_latency_ms Layer latency histogram (ms).');
        lines.push('# TYPE layer_latency_ms histogram');
        for (const s of this.layerLatencyMs.snapshots()) {
            let cum = 0;
            for (let i = 0; i < lb.length; i++) {
                cum += s.counts[i] || 0;
                const lbl = Object.entries({ ...s.labels, le: String(lb[i]) })
                    .map(([k, v]) => `${k}="${v}` + '"')
                    .join(',');
                lines.push(`layer_latency_ms_bucket{${lbl}} ${cum}`);
            }
            const lblInf = Object.entries({ ...s.labels, le: '+Inf' })
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`layer_latency_ms_bucket{${lblInf}} ${s.count}`);
            const lbl = Object.entries(s.labels)
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`layer_latency_ms_sum{${lbl}} ${s.sum}`);
            lines.push(`layer_latency_ms_count{${lbl}} ${s.count}`);
        }

        // Gauge: inflight_requests
        lines.push('# HELP inflight_requests In-flight requests by adapter.');
        lines.push('# TYPE inflight_requests gauge');
        for (const { labels, value } of this.inflightRequests.entries()) {
            const lbl = Object.entries(labels)
                .map(([k, v]) => `${k}="${v}` + '"')
                .join(',');
            lines.push(`inflight_requests{${lbl}} ${value}`);
        }

        if (!lines[lines.length - 1].endsWith('\n')) lines.push('');
        return lines.join('\n');
    }
}

// Singleton registry for process
export const metricsRegistry = new MetricsRegistry();

// Convenience wrappers for adapters/servers
export const recordToolStart = (adapter: string) => metricsRegistry.recordToolStart(adapter);
export const recordToolEnd = (adapter: string, tool: string, durationMs: number, success: boolean) =>
    metricsRegistry.recordToolEnd(adapter, tool, durationMs, success);
export const recordError = (adapter: string, code: string) => metricsRegistry.recordError(adapter, code);
export const recordLayerLatency = (adapter: string, layer: string, durationMs: number) =>
    metricsRegistry.recordLayerLatency(adapter, layer, durationMs);

export function buildPushgatewayUrl(url: string, job: string, instance?: string): string {
    const baseUrl = url.replace(/\/+$/, '');
    let pushUrl = `${baseUrl}/metrics/job/${encodeURIComponent(job)}`;
    if (instance) {
        pushUrl += `/instance/${encodeURIComponent(instance)}`;
    }
    return pushUrl;
}

function pushgatewayTimeoutSignal(): AbortSignal | undefined {
    const timeoutMs = Number(process.env.PUSHGATEWAY_TIMEOUT_MS ?? 5000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
    return AbortSignal.timeout(timeoutMs);
}

/**
 * Push metrics to a Prometheus Pushgateway.
 *
 * @param url - Pushgateway base URL (e.g., "http://localhost:9091")
 * @param job - Job name for grouping metrics (e.g., "ontology_cli")
 * @param instance - Optional instance label (defaults to hostname)
 * @returns Promise that resolves on success, rejects on failure
 *
 * Protocol: POST to {url}/metrics/job/{job}/instance/{instance}
 * Body: Prometheus text format
 * Content-Type: text/plain; version=0.0.4
 */
export async function pushToGateway(
    url: string,
    job: string,
    instance?: string
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    try {
        const metrics = metricsRegistry.renderPrometheusText();

        // Skip push if no metrics recorded
        if (!metrics.trim() || metrics.split('\n').filter((l) => !l.startsWith('#') && l.trim()).length === 0) {
            return { success: true, statusCode: 0 }; // No-op: nothing to push
        }

        // Build Pushgateway URL: /metrics/job/{job}[/instance/{instance}]
        const pushUrl = buildPushgatewayUrl(url, job, instance);

        const response = await fetch(pushUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; version=0.0.4',
            },
            body: metrics,
            signal: pushgatewayTimeoutSignal(),
        });

        if (response.ok) {
            return { success: true, statusCode: response.status };
        } else {
            const errorText = await response.text().catch(() => '');
            return {
                success: false,
                statusCode: response.status,
                error: `Pushgateway returned ${response.status}: ${errorText}`.trim(),
            };
        }
    } catch (e) {
        return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

/**
 * Get the Pushgateway URL from environment.
 * @returns URL string or undefined if not configured
 */
export function getPushgatewayUrl(): string | undefined {
    return process.env.PUSHGATEWAY_URL || process.env.PROMETHEUS_PUSHGATEWAY_URL;
}

/**
 * Check if metrics should be pushed on CLI exit.
 * Returns true if PUSHGATEWAY_URL is set.
 */
export function shouldPushMetrics(): boolean {
    return !!getPushgatewayUrl();
}
