import type { ToolSpec } from './registry.js';
import { ALPHA_TOOL_SPECS } from './tool-specs-alpha.js';
import { LEGACY_TOOL_SPECS } from './tool-specs-legacy.js';
import { OPERATION_TOOL_SPECS } from './tool-specs-operations.js';
import { PREFERRED_WORKFLOW_TOOL_SPECS } from './tool-specs-preferred-workflows.js';

export const TOOL_SPECS: ToolSpec[] = [
    ...ALPHA_TOOL_SPECS,
    ...OPERATION_TOOL_SPECS,
    ...LEGACY_TOOL_SPECS,
    ...PREFERRED_WORKFLOW_TOOL_SPECS,
];
