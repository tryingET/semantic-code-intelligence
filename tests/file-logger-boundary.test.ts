import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLogger } from '../src/mcp/file-logger';

describe('MCP file logger boundary safety', () => {
    test('does not follow a preexisting log-file symlink', () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-file-logger-'));
        const logDir = join(root, 'workspace', '.ontology', 'logs');
        const outside = join(root, 'outside.log');
        mkdirSync(logDir, { recursive: true });
        const logFile = join(logDir, `mcp-server-${new Date().toISOString().split('T')[0]}.log`);
        symlinkSync(outside, logFile);

        try {
            const logger = new FileLogger({ logDir, enableConsole: false });
            logger.info('test', 'must not follow symlink');

            expect(existsSync(outside)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('does not follow a log directory replaced with a symlink after construction', () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-file-logger-'));
        const logDir = join(root, 'workspace', '.ontology', 'logs');
        const outsideDir = join(root, 'outside');
        mkdirSync(logDir, { recursive: true });
        mkdirSync(outsideDir, { recursive: true });
        const outsideLog = join(outsideDir, `mcp-server-${new Date().toISOString().split('T')[0]}.log`);

        try {
            const logger = new FileLogger({ logDir, enableConsole: false });
            rmSync(logDir, { recursive: true, force: true });
            symlinkSync(outsideDir, logDir, 'dir');
            logger.info('test', 'must not follow replaced directory symlink');

            expect(existsSync(outsideLog)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('writes ordinary logs to a non-symlink file', () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-file-logger-'));
        const logDir = join(root, 'workspace', '.ontology', 'logs');
        mkdirSync(logDir, { recursive: true });
        const logFile = join(logDir, `mcp-server-${new Date().toISOString().split('T')[0]}.log`);

        try {
            const logger = new FileLogger({ logDir, enableConsole: false });
            logger.info('test', 'ordinary write');

            expect(readFileSync(logFile, 'utf8')).toContain('ordinary write');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('preserves both structured error and data fields', () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-file-logger-'));
        const logDir = join(root, 'workspace', '.ontology', 'logs');
        mkdirSync(logDir, { recursive: true });
        const logFile = join(logDir, `mcp-server-${new Date().toISOString().split('T')[0]}.log`);

        try {
            const logger = new FileLogger({ logDir, enableConsole: false });
            logger.error('test', 'error with context', new Error('boom'), { requestId: 'req-1' });

            const entry = JSON.parse(readFileSync(logFile, 'utf8').trim());
            expect(entry.error.message).toBe('boom');
            expect(entry.error.stack).toContain('boom');
            expect(entry.data).toEqual({ requestId: 'req-1' });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
