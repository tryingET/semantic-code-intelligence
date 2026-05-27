import { CoreError } from './errors.js';

export function parseBoundedInteger(
    value: unknown,
    label: string,
    opts: { defaultValue: number; min?: number; max?: number }
): number {
    const min = opts.min ?? Number.MIN_SAFE_INTEGER;
    const max = opts.max ?? Number.MAX_SAFE_INTEGER;
    const raw = value === undefined || value === null || value === '' ? opts.defaultValue : value;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new CoreError('InvalidParams', `${label} must be an integer from ${min} to ${max}`, { value });
    }
    if (parsed < min || parsed > max) {
        throw new CoreError('InvalidParams', `${label} must be an integer from ${min} to ${max}`, { value });
    }
    return parsed;
}

export function requireNonEmptyString(args: Record<string, any>, field: string, label = field): string {
    const value = String(args?.[field] ?? '').trim();
    if (!value) throw new CoreError('InvalidParams', `Missing required parameter: ${label}`, { field });
    return value;
}
