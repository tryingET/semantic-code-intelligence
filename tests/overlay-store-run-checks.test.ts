import { describe, expect, test } from 'bun:test';
import { overlayStore } from '../src/core/overlay-store.js';

describe('OverlayStore runChecks evidence receipts', () => {
    test('runs shell-style quoted commands and records receipts', async () => {
        const snap = overlayStore.createSnapshot(false);
        const result = await overlayStore.runChecks(snap.id, ['bash -lc "exit 0"'], 30);

        expect(result.ok).toBe(true);
        expect(result.commands[0]).toMatchObject({
            command: 'bash -lc "exit 0"',
            ok: true,
            exitCode: 0,
            timedOut: false,
        });
    });

    test('caps noisy command output while preserving failure receipts', async () => {
        const snap = overlayStore.createSnapshot(false);
        const result = await overlayStore.runChecks(snap.id, ['yes'], 1);

        expect(result.ok).toBe(false);
        expect(result.output).toContain('[output truncated at');
        expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThan(1024 * 1024 + 128);
        expect(result.commands[0]).toMatchObject({ command: 'yes', ok: false, timedOut: true });
    }, 5000);
});
