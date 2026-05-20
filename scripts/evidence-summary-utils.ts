import { relative, isAbsolute } from 'node:path';

export function isContainedPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function redactString(value: string): string {
  const home = process.env.HOME || '';
  let text = value;
  if (home) text = text.split(home).join('<home>');
  text = text.split(process.cwd()).join('<workspace>');
  text = text.replace(/\b[A-Za-z_][A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|KEY)\s*=\s*[^\s,;]+/gi, '<redacted-secret>');
  text = text.replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, '<redacted-token>');
  text = text.replace(/(^|[\s'"(])\/(?:home|Users|tmp|var|private|mnt|opt)\/[^\s'"),;]+/g, '$1<absolute-path>');
  return text;
}

export function sanitizeEvidence(value: any): any {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item)]));
  }
  return value;
}

export function strings(value: any): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean).map(redactString) : [];
}

export function callFailed(call: any): boolean {
  if (!call || typeof call !== 'object') return true;
  if (call.success !== true) return true;
  if (call.payload?.ok === false) return true;
  if (call.payload?.checks?.ok === false) return true;
  if (call.payload?.validationPlan?.checks?.ok === false) return true;
  return false;
}

export function summarizeCalls(calls: any[]) {
  return calls.map((call) => ({
    name: String(call?.name || ''),
    success: call?.success === true,
    elapsedMs: Number(call?.elapsedMs || 0),
    observation: typeof call?.observation === 'string' ? redactString(call.observation) : undefined,
  }));
}

export function maxElapsed(calls: any[]): number {
  return Math.max(0, ...calls.map((call) => Number(call?.elapsedMs || 0)).filter((value) => Number.isFinite(value)));
}
