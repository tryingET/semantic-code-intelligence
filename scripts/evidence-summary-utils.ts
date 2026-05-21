import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeSync, type Stats } from 'node:fs';
import { relative, isAbsolute } from 'node:path';

export const defaultMaxEvidenceJsonBytes = 10 * 1024 * 1024;

export function isContainedPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function evidenceTooLargeError(sizeDescription: string, maxBytes = defaultMaxEvidenceJsonBytes): Error {
  return new Error(`Evidence input too large: ${sizeDescription} exceeds ${maxBytes} byte limit`);
}

function sameObservedFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function assertSameObservedFile(label: string, expected: Stats, actual: Stats) {
  if (!sameObservedFile(expected, actual)) throw new Error(`Evidence input changed while it was being ${label}`);
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
}

function readBoundedUtf8(fd: number, maxBytes = defaultMaxEvidenceJsonBytes): string {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const remainingWithSentinel = maxBytes + 1 - totalBytes;
    if (remainingWithSentinel <= 0) throw evidenceTooLargeError('more than limit', maxBytes);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithSentinel));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) throw evidenceTooLargeError(`${totalBytes} bytes`, maxBytes);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

export function readEvidenceJsonFile(path: string, maxBytes = defaultMaxEvidenceJsonBytes): any {
  let initialStat: Stats;
  try {
    initialStat = lstatSync(path);
  } catch {
    throw new Error('Evidence input is unavailable or unreadable');
  }
  if (!initialStat.isFile()) throw new Error('Evidence input must be a regular file');
  if (initialStat.size > maxBytes) throw evidenceTooLargeError(`${initialStat.size} bytes`, maxBytes);

  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | noFollowFlag());
  } catch {
    throw new Error('Evidence input is unavailable or unreadable');
  }

  try {
    const openedStat = fstatSync(fd);
    if (!openedStat.isFile()) throw new Error('Evidence input must be a regular file');
    assertSameObservedFile('opened', initialStat, openedStat);
    if (openedStat.size > maxBytes) throw evidenceTooLargeError(`${openedStat.size} bytes`, maxBytes);
    const text = readBoundedUtf8(fd, maxBytes);
    assertSameObservedFile('read', openedStat, fstatSync(fd));
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Evidence input is not valid JSON');
    }
  } finally {
    closeSync(fd);
  }
}

export function safeEvidenceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactString(message);
}

export function writeTextFileNoSymlink(path: string, text: string): void {
  try {
    const existing = lstatSync(path);
    if (!existing.isFile()) throw new Error('Evidence output must be a regular file');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag(), 0o666);
  } catch {
    throw new Error('Evidence output is unavailable or unsafe to write');
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Evidence output must be a regular file');
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
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
