import { alphaMvpToolNames, assertAlphaMvpToolAllowed } from '../tools/alpha-surface.js';

export type HttpToolSurface = 'HTTP tools/call surface' | 'HTTP adapter surface' | string;

export function defaultHttpToolNames(_env: NodeJS.ProcessEnv = process.env): Set<string> {
    return new Set<string>(alphaMvpToolNames());
}

export function assertHttpToolAllowed(
    name: string,
    args: Record<string, any>,
    opts: { surface?: HttpToolSurface; allowedToolNames?: string[]; env?: NodeJS.ProcessEnv } = {}
): void {
    const surface = opts.surface || 'HTTP tools/call surface';
    const env = opts.env || process.env;
    const alphaNames = defaultHttpToolNames(env);
    const allowed = opts.allowedToolNames
        ? new Set<string>(opts.allowedToolNames.filter((toolName) => alphaNames.has(toolName)))
        : alphaNames;

    assertAlphaMvpToolAllowed(name, args, { surface, env, allowedToolNames: allowed });
}
