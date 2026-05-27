import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { overlayStore } from "../overlay-store.js";
import { openWorkspaceFileForRead } from "../workspace-path.js";

export type SnapshotWorkflowResult =
  | { payload: unknown; isError?: boolean }
  | { text: string; isError?: boolean };

type RecommendChecksArgs = Record<string, any>;

export function snapshotArtifactLinks(snapshot: string) {
  return {
    overlayDiff: `snapshot://${snapshot}/overlay.diff`,
    status: `snapshot://${snapshot}/status`,
    progress: `snapshot://${snapshot}/progress`,
  };
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function shellQuoteIfNeeded(value: string): string {
  const raw = String(value);
  return /^[A-Za-z0-9_./:@+-]+$/.test(raw) ? raw : shellQuote(raw);
}

function bunTestCommandForFile(file: string): string {
  const rendered = String(file).startsWith('-') ? shellQuote(file) : shellQuoteIfNeeded(file);
  return String(file).startsWith('-') ? `bun test -- ${rendered}` : `bun test ${rendered}`;
}

function stripUnifiedHeaderMetadata(rawPath: string): string {
  const raw = String(rawPath || '').trim();
  const tab = raw.indexOf('\t');
  if (tab >= 0) return raw.slice(0, tab).trim();
  const timestamp = /^(.*?)\s+\d{4}-\d{2}-\d{2}(?:\s|T|$)/.exec(raw);
  return timestamp?.[1]?.trim() || raw;
}

function clampMaxBytes(value: unknown, fallback = 65_536): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(262_144, Math.floor(parsed))) : fallback;
}

function truncateUtf8WholeCodePoints(text: string, maxBytes: number): { text: string; truncated: boolean } {
  let bytes = 0;
  let truncated = false;
  const out: string[] = [];
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) {
      truncated = true;
      break;
    }
    out.push(char);
    bytes += charBytes;
  }
  return { text: out.join(""), truncated: truncated || bytes < Buffer.byteLength(text, "utf8") };
}

export function extractFilesFromPatch(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = /^(?:\+\+\+|---)\s+(?:a\/|b\/)?(.+)$/.exec(line.trim());
    if (!match) continue;
    const file = stripUnifiedHeaderMetadata(match[1] || '');
    if (!file || file === "/dev/null") continue;
    files.add(file);
  }
  return [...files].sort();
}

export function classifyPatchRisk(patch: string) {
  const files = new Set<string>();
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    let m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      files.add(m[1]);
      files.add(m[2]);
    }
    m = line.match(/^\+\+\+\s+b\/(.+)$/) || line.match(/^---\s+a\/(.+)$/);
    if (m) files.add(m[1]);
    if (
      line.startsWith("deleted file mode") ||
      line.startsWith("*** Delete File:")
    )
      deletions += 1;
  }
  const list = Array.from(files).filter((file) => file !== "/dev/null");
  const docsOnly =
    list.length > 0 && list.every((file) => /(^docs\/|\.md$)/.test(file));
  const testsOnly =
    list.length > 0 &&
    list.every((file) => /(^tests\/|\.test\.|\.spec\.)/.test(file));
  const source = list.some((file) => /^src\//.test(file));
  const level =
    deletions > 0 || list.length > 10 ? "high" : source ? "medium" : "low";
  return {
    level,
    category: docsOnly
      ? "docs_only"
      : testsOnly
        ? "tests_only"
        : source
          ? "source_change"
          : "mixed_change",
    files: list,
    fileCount: list.length,
    deletions,
  };
}

export function normalizeRecommendationFiles(
  args: RecommendChecksArgs,
): string[] {
  const explicit = Array.isArray(args?.files)
    ? args.files.filter((file: any) => typeof file === "string")
    : [];
  const patchFiles =
    typeof args?.patch === "string" ? extractFilesFromPatch(args.patch) : [];
  return [
    ...new Set(
      [...explicit, ...patchFiles].map((file) => file.trim()).filter(Boolean),
    ),
  ].sort();
}

export function hasGraphImpact(impactSummary: any): boolean {
  const counts =
    impactSummary?.counts && typeof impactSummary.counts === "object"
      ? impactSummary.counts
      : {};
  return ["imports", "exports", "callers", "callees"].some(
    (edge) => Number(counts?.[edge] || 0) > 0,
  );
}

export function buildValidationPlan(args: {
  workflow: string;
  mode: string;
  snapshot?: string;
  snapshotArtifacts?: any;
  risk?: any;
  commands: string[];
  checksOk: boolean;
  checksElapsedMs: number | null;
  checkCommands?: Array<{
    command: string;
    ok?: boolean | null;
    elapsedMs?: number;
    exitCode?: number | null;
    timedOut?: boolean;
  }>;
  checkRecommendations?: any;
  impactSummary?: any;
  applied: boolean;
  applyGuardSatisfied: boolean;
  rollback?: any;
  verification?: any;
}) {
  const recommendedMinimum = Array.isArray(args.checkRecommendations?.minimum)
    ? args.checkRecommendations.minimum.map(String)
    : [];
  const recommendedBroader = Array.isArray(args.checkRecommendations?.broader)
    ? args.checkRecommendations.broader.map(String)
    : [];
  const rationale = Array.isArray(args.checkRecommendations?.rationale)
    ? args.checkRecommendations.rationale
    : [];
  const impactCounts =
    args.impactSummary?.counts && typeof args.impactSummary.counts === "object"
      ? args.impactSummary.counts
      : null;
  const impactSeed =
    args.impactSummary?.seed && typeof args.impactSummary.seed === "object"
      ? {
          kind: String(args.impactSummary.seed.kind || "unknown"),
          value: String(args.impactSummary.seed.value || ""),
        }
      : null;
  const languageSupport =
    args.impactSummary?.languageSupport &&
    typeof args.impactSummary.languageSupport === "object"
      ? {
          language: String(
            args.impactSummary.languageSupport.language || "unknown",
          ),
          support: String(
            args.impactSummary.languageSupport.support || "unknown",
          ),
          supportedEdges: Array.isArray(
            args.impactSummary.languageSupport.supportedEdges,
          )
            ? args.impactSummary.languageSupport.supportedEdges.map(String)
            : [],
        }
      : null;
  const edgeEvidence = Array.isArray(args.impactSummary?.evidence)
    ? args.impactSummary.evidence.map((item: any) => ({
        edge: String(item?.edge || "unknown"),
        count: Number(item?.count || 0),
        status: String(item?.status || "unknown"),
        limitations: Array.isArray(item?.limitations)
          ? item.limitations.map(String)
          : [],
      }))
    : [];
  return {
    schema: "semantic-code-intelligence.validation_plan.v1",
    workflow: args.workflow,
    mode: args.mode,
    snapshot: args.snapshot || null,
    status: args.checksOk ? "checks_passed" : "checks_failed",
    touchedFiles: Array.isArray(args.risk?.files) ? args.risk.files : [],
    risk: args.risk
      ? {
          level: args.risk.level,
          category: args.risk.category,
          fileCount: args.risk.fileCount,
        }
      : null,
    commands: {
      selected: args.commands,
      recommendedMinimum,
      recommendedBroader,
      recommendationsAppliedToSelected: false,
    },
    rationale,
    graphImpact: args.impactSummary
      ? {
          seed: impactSeed,
          languageSupport,
          backend:
            typeof args.impactSummary?.backend === "string"
              ? args.impactSummary.backend
              : null,
          freshness:
            typeof args.impactSummary?.freshness === "string"
              ? args.impactSummary.freshness
              : null,
          requestedEdges: Array.isArray(args.impactSummary?.requestedEdges)
            ? args.impactSummary.requestedEdges.map(String)
            : [],
          counts: impactCounts,
          evidence: edgeEvidence,
          limitations: Array.isArray(args.impactSummary?.limitations)
            ? args.impactSummary.limitations.map(String)
            : [],
          callerContextCount:
            typeof args.impactSummary?.callerContextCount === "number"
              ? args.impactSummary.callerContextCount
              : null,
          hasImpactEvidence: args.impactSummary?.hasImpactEvidence === true,
          planningHints: Array.isArray(args.impactSummary?.planningHints)
            ? args.impactSummary.planningHints.map(String)
            : [],
        }
      : null,
    checks: {
      ok: args.checksOk,
      elapsedMs: args.checksElapsedMs,
      commands: Array.isArray(args.checkCommands) ? args.checkCommands : [],
    },
    artifacts: args.snapshotArtifacts
      ? {
          overlayDiff: args.snapshotArtifacts.overlayDiff,
          status: args.snapshotArtifacts.status,
          progress: args.snapshotArtifacts.progress,
        }
      : null,
    apply: { applied: args.applied, guardSatisfied: args.applyGuardSatisfied },
    rollback: args.rollback
      ? {
          available: !!args.rollback.available,
          command: args.rollback.command,
          artifact: args.rollback.artifact,
        }
      : null,
    verification: args.verification
      ? {
          staged: args.verification.staged === true,
          checksPassed: args.verification.checksPassed === true,
          applyGuardSatisfied: args.verification.applyGuardSatisfied === true,
          applied: args.verification.applied === true,
          appliedDiffMatchesSnapshot:
            typeof args.verification.appliedDiffMatchesSnapshot === "boolean"
              ? args.verification.appliedDiffMatchesSnapshot
              : null,
          method:
            typeof args.verification.method === "string"
              ? args.verification.method
              : null,
          diagnostics:
            args.verification.diagnostics &&
            typeof args.verification.diagnostics === "object"
              ? args.verification.diagnostics
              : null,
        }
      : null,
    note: "Evidence summary only; it does not select, append, or enforce validation commands.",
  };
}

export function recommendChecksPayload(args: RecommendChecksArgs) {
  const files = normalizeRecommendationFiles(args);
  const mode = args?.mode === "broader" ? "broader" : "minimum";
  const impactSummary =
    args?.impactSummary && typeof args.impactSummary === "object"
      ? args.impactSummary
      : null;
  const rationale: Array<{
    reason: string;
    files?: string[];
    command?: string;
    detail?: string;
  }> = [];
  const minimum = new Set<string>();
  const broader = new Set<string>();
  const addMinimum = (command: string) => {
    minimum.add(command);
    broader.add(command);
  };
  const addBroader = (command: string) => broader.add(command);

  const docs = files.filter(
    (file) => /(^|\/)docs\//.test(file) || /\.mdx?$/.test(file),
  );
  const docsProject = docs.filter((file) => file.startsWith("docs/project/"));
  const tsSource = files.filter((file) => /^src\/.*\.[cm]?tsx?$/.test(file));
  const tests = files.filter(
    (file) =>
      /(^|\/)(tests?|__tests__)\//.test(file) ||
      /(?:^|[.\/-])(test|spec)\.[cm]?[tj]sx?$/.test(file),
  );
  const configs = files.filter((file) =>
    /(^package\.json$|^bun\.lockb?$|^tsconfig.*\.json$|^justfile$|^Justfile$|^\.github\/workflows\/|^scripts\/.*\.[cm]?tsx?$)/.test(
      file,
    ),
  );
  const nonDocs = files.filter((file) => !docs.includes(file));

  if (files.length === 0) {
    addMinimum("bun run typecheck");
    rationale.push({
      reason: "no_touched_files_supplied",
      command: "bun run typecheck",
      detail:
        "Conservative default when neither files nor parseable patch paths are supplied.",
    });
  }

  if (files.length > 0 && nonDocs.length === 0) {
    addMinimum("true");
    rationale.push({
      reason:
        docsProject.length > 0
          ? "docs_project_changed"
          : "markdown_only_changed",
      files: docs,
      command: "true",
    });
  }

  if (tsSource.length > 0) {
    addMinimum("bun run typecheck");
    rationale.push({
      reason: "typescript_source_changed",
      files: tsSource,
      command: "bun run typecheck",
    });
  }

  for (const file of tests) {
    const command = bunTestCommandForFile(file);
    addMinimum(command);
    rationale.push({ reason: "test_file_changed", files: [file], command });
  }
  if (tests.length > 0) {
    addBroader("bun run typecheck");
  }

  if (configs.length > 0) {
    addMinimum("bun run typecheck");
    addBroader("bun test");
    rationale.push({
      reason: "package_or_config_changed",
      files: configs,
      command: "bun run typecheck",
    });
  }

  if (
    impactSummary &&
    hasGraphImpact(impactSummary) &&
    (tsSource.length > 0 || files.some((file) => /\.[cm]?[tj]sx?$/.test(file)))
  ) {
    addBroader("bun run typecheck");
    rationale.push({
      reason: "graph_impact_edges_present",
      command: "consider broader validation",
      detail:
        "graph_expand impactSummary has non-empty imports/exports/callers/callees counts for a source-adjacent change.",
    });
  }

  if (minimum.size === 0) {
    addMinimum("bun run typecheck");
    rationale.push({
      reason: "fallback_unknown_change_shape",
      files,
      command: "bun run typecheck",
    });
  }

  const minimumCommands = [...minimum];
  const broaderCommands = [...broader];
  const commands = mode === "broader" ? broaderCommands : minimumCommands;
  const confidence =
    files.length === 0
      ? "low"
      : impactSummary && hasGraphImpact(impactSummary)
        ? "medium"
        : "medium";
  return {
    workflow: "recommend_checks",
    ok: true,
    mode,
    commands,
    minimum: minimumCommands,
    broader: broaderCommands,
    rationale,
    confidence,
    inputs: {
      files,
      hasPatch: typeof args?.patch === "string" && args.patch.trim().length > 0,
      hasImpactSummary: !!impactSummary,
    },
    note: "Heuristic recommendation only; callers remain responsible for choosing and running validation.",
  };
}

export class SnapshotPatchWorkflowService {
  constructor(private readonly options: { workspaceRoot: () => string }) {}

  get workspaceRoot(): string {
    return this.options.workspaceRoot();
  }

  async getSnapshot(
    args: Record<string, any>,
  ): Promise<SnapshotWorkflowResult> {
    const snap = overlayStore.createSnapshot(!!args?.preferExisting, {
      workspaceRoot: this.workspaceRoot,
    });
    return { payload: { snapshot: snap.id }, isError: false };
  }

  async extractSnapshotArtifacts(
    args: Record<string, any>,
  ): Promise<SnapshotWorkflowResult> {
    const snapshot = String(args?.snapshot || "").trim();
    if (!snapshot) return { text: "snapshot required", isError: true };

    const includeContent = args?.includeContent === true;
    const maxBytes = clampMaxBytes(args?.maxBytes);
    const links = [
      { uri: `snapshot://${snapshot}/overlay.diff`, name: "overlay.diff", mimeType: "text/plain" },
      { uri: `snapshot://${snapshot}/status`, name: "status", mimeType: "application/json" },
      { uri: `snapshot://${snapshot}/progress`, name: "progress", mimeType: "text/plain" },
    ];
    let status: any = { id: snapshot, exists: false, diffCount: 0, createdAt: null };
    let contents: any = undefined;

    try {
      const snap = overlayStore.ensureSnapshot(snapshot, {
        workspaceRoot: this.workspaceRoot,
      });
      status = {
        id: snapshot,
        exists: true,
        diffCount: Array.isArray((snap as any).diffs) ? (snap as any).diffs.length : 0,
        createdAt: (snap as any).createdAt || null,
        touchedFiles: (snap as any).touchedFiles ? Array.from((snap as any).touchedFiles) : [],
        materialized: false,
      };

      const snapshotDir =
        (overlayStore as any).getSnapshotDirectory?.(snapshot, {
          workspaceRoot: this.workspaceRoot,
        }) || path.resolve(this.workspaceRoot, ".ontology", "snapshots", snapshot);
      const materializedMarker = path.join(snapshotDir, ".materialized");
      const hasMaterializedMarker = async () => {
        try {
          const stat = await fs.lstat(materializedMarker);
          return stat.isFile() && !stat.isSymbolicLink();
        } catch {
          return false;
        }
      };

      status.materialized = await hasMaterializedMarker();
      let dir: string | null = null;
      if (includeContent) {
        const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
        dir = ensure
          ? await ensure(snapshot, { workspaceRoot: this.workspaceRoot })
          : status.materialized
            ? snapshotDir
            : null;
        status.materialized = !!dir && (await hasMaterializedMarker());
      }

      if (includeContent && dir) {
        const readBounded = async (file: string) => {
          try {
            const filePath = path.join(dir, file);
            const stat = await fs.lstat(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) {
              return { text: "", truncated: false };
            }
            const [realDir, realFile] = await Promise.all([
              fs.realpath(dir),
              fs.realpath(filePath),
            ]);
            const relative = path.relative(realDir, realFile);
            if (relative.startsWith("..") || path.isAbsolute(relative)) {
              return { text: "", truncated: false };
            }
            const text = await fs.readFile(filePath, "utf8");
            return truncateUtf8WholeCodePoints(text, maxBytes);
          } catch {
            return { text: "", truncated: false };
          }
        };
        contents = {
          overlayDiff: await readBounded("overlay.diff"),
          progress: await readBounded("progress.log"),
        };
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
    }

    return {
      payload: { snapshot, links, status, contents },
      isError: !status.exists || !!status.error,
    };
  }

  async proposePatch(
    args: Record<string, any>,
  ): Promise<SnapshotWorkflowResult> {
    const patch = String(args?.patch || "");
    const snapshot = String(args?.snapshot || "");
    if (!patch) {
      return {
        payload: {
          accepted: false,
          snapshot,
          reason: "missing_patch",
          message: "Missing patch",
        },
        isError: true,
      };
    }

    let snap: ReturnType<typeof overlayStore.ensureSnapshot>;
    try {
      snap = overlayStore.ensureSnapshot(snapshot, {
        workspaceRoot: this.workspaceRoot,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        payload: {
          accepted: false,
          snapshot,
          reason: "invalid_snapshot",
          message: msg,
        },
        isError: true,
      };
    }

    try {
      const isApplyPatch = /\*\*\*\s+Begin Patch/.test(patch);
      const unified = isApplyPatch
        ? await this.convertApplyPatchToUnified(patch, { snapshotId: snap.id })
        : patch;
      const res = overlayStore.stagePatch(snap.id, unified);
      return {
        payload: {
          accepted: res.accepted,
          snapshot: snap.id,
          message: res.message,
        },
        isError: !res.accepted,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        payload: {
          accepted: false,
          snapshot: snap.id,
          reason: "invalid_patch",
          message: msg,
        },
        isError: true,
      };
    }
  }

  async convertApplyPatchToUnified(
    patch: string,
    options: { snapshotId?: string } = {},
  ): Promise<string> {
    type HunkLine = { op: " " | "+" | "-"; text: string };
    const lines = patch.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    let i = 0;
    const isFileHeader = (s: string) =>
      /^\*\*\*\s+(Update|Add|Delete) File: /i.test(s);
    const splitFileLines = (text: string) => {
      const fileLines = text.replace(/\r\n/g, "\n").split("\n");
      if (fileLines.length && fileLines[fileLines.length - 1] === "")
        fileLines.pop();
      return fileLines;
    };
    const findSequences = (
      haystack: string[],
      needle: string[],
      startAt: number,
    ): number[] => {
      if (!needle.length) return [];
      const matches: number[] = [];
      for (
        let pos = Math.max(0, startAt);
        pos <= haystack.length - needle.length;
        pos++
      ) {
        let ok = true;
        for (let offset = 0; offset < needle.length; offset++) {
          if (haystack[pos + offset] !== needle[offset]) {
            ok = false;
            break;
          }
        }
        if (ok) matches.push(pos);
      }
      return matches;
    };
    const readSourceLines = async (file: string): Promise<string[]> => {
      let workspaceRoot = this.workspaceRoot;
      const snapshotId = options.snapshotId;
      if (snapshotId) {
        const snap = overlayStore.ensureSnapshot(snapshotId, {
          workspaceRoot: this.workspaceRoot,
        });
        if (Array.isArray((snap as any).diffs) && (snap as any).diffs.length > 0) {
          const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
          const materializedRoot = ensure
            ? await ensure(snapshotId, { workspaceRoot: this.workspaceRoot })
            : null;
          if (materializedRoot) workspaceRoot = materializedRoot;
        }
      }

      const opened = await openWorkspaceFileForRead(file, {
        workspaceRoot,
        inputLabel: "apply_patch file",
      });
      let fileText: string;
      try {
        fileText = await opened.handle.readFile("utf8");
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
      return splitFileLines(fileText);
    };

    const buildHunks = async (
      kind: string,
      file: string,
      rawChunk: string[],
    ) => {
      const hunks: HunkLine[][] = [];
      let current: HunkLine[] = [];
      for (const line of rawChunk) {
        if (/^@@/.test(line)) {
          if (current.length) hunks.push(current);
          current = [];
          continue;
        }
        if (/^[ +-]/.test(line))
          current.push({ op: line[0] as HunkLine["op"], text: line.slice(1) });
      }
      if (current.length) hunks.push(current);
      if (!hunks.length)
        throw new Error(`apply_patch conversion found no hunks for ${file}`);

      if (kind === "add") {
        let newLine = 1;
        return hunks.flatMap((hunk) => {
          const newLines = hunk.filter((line) => line.op !== "-");
          const header = `@@ -0,0 +${newLine},${newLines.length} @@`;
          newLine += newLines.length;
          return [header, ...hunk.map((line) => `${line.op}${line.text}`)];
        });
      }

      const sourceLines = await readSourceLines(file);
      let cursor = 0;
      return hunks.flatMap((hunk) => {
        const oldLines = hunk
          .filter((line) => line.op !== "+")
          .map((line) => line.text);
        const newLines = hunk
          .filter((line) => line.op !== "-")
          .map((line) => line.text);
        const matches = findSequences(sourceLines, oldLines, cursor);
        if (matches.length > 1)
          throw new Error(`apply_patch hunk is ambiguous for ${file}`);
        const match = matches[0] ?? -1;
        if (match >= 0) {
          cursor = match + Math.max(oldLines.length, 1);
          return [
            `@@ -${match + 1},${oldLines.length} +${match + 1},${newLines.length} @@`,
            ...hunk.map((line) => `${line.op}${line.text}`),
          ];
        }

        const changed = hunk.filter((line) => line.op !== " ");
        const oldChanged = changed
          .filter((line) => line.op === "-")
          .map((line) => line.text);
        const newChanged = changed
          .filter((line) => line.op !== "-")
          .map((line) => line.text);
        const changedMatches = findSequences(sourceLines, oldChanged, cursor);
        if (changedMatches.length === 0)
          throw new Error(`apply_patch hunk did not match ${file}`);
        if (changedMatches.length > 1)
          throw new Error(`apply_patch hunk is ambiguous for ${file}`);
        const changedMatch = changedMatches[0];
        cursor = changedMatch + Math.max(oldChanged.length, 1);
        return [
          `@@ -${changedMatch + 1},${oldChanged.length} +${changedMatch + 1},${newChanged.length} @@`,
          ...changed.map((line) => `${line.op}${line.text}`),
        ];
      });
    };
    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(/^\*\*\*\s+(Update|Add|Delete) File:\s+(.+)$/i);
      if (!m) {
        i++;
        continue;
      }
      const kind = m[1].toLowerCase();
      const file = m[2].trim();
      i++;
      const chunk: string[] = [];
      while (
        i < lines.length &&
        !isFileHeader(lines[i]) &&
        !/^\*\*\*\s+End Patch$/i.test(lines[i])
      ) {
        const l = lines[i];
        if (/^@@/.test(l) || /^[ +-]/.test(l)) {
          chunk.push(l);
        }
        i++;
      }
      if (kind === "delete") {
        throw new Error(`apply_patch delete not supported for ${file}`);
      }
      out.push(`diff --git a/${file} b/${file}`);
      if (kind === "add") {
        out.push("--- /dev/null");
        out.push(`+++ b/${file}`);
      } else {
        out.push(`--- a/${file}`);
        out.push(`+++ b/${file}`);
      }
      out.push(...(await buildHunks(kind, file, chunk)));
    }
    const joined = out.join("\n");
    if (!joined.trim()) {
      throw new Error("apply_patch conversion produced empty diff");
    }
    return joined + (joined.endsWith("\n") ? "" : "\n");
  }

  async runChecks(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
    const snapshot = String(args?.snapshot || "");
    if (!snapshot) {
      return { text: "Missing snapshot", isError: true };
    }
    const cmds = Array.isArray(args?.commands)
      ? (args?.commands as string[])
      : [];
    const timeoutSec =
      typeof args?.timeoutSec === "number" ? args.timeoutSec : 120;
    const onlyTouchedEnv =
      (process.env.FAST_STDIO_CHECKS || "").toLowerCase() === "touched";
    const onlyTouched =
      typeof args?.onlyTouched === "boolean"
        ? !!args.onlyTouched
        : onlyTouchedEnv;
    let res: any;
    try {
      res = await overlayStore.runChecks(snapshot, cmds, timeoutSec, {
        onlyTouched,
        workspaceRoot: this.workspaceRoot,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { text: `Invalid snapshot: ${msg}`, isError: true };
    }
    return {
      payload: {
        snapshot,
        ok: res.ok,
        elapsedMs: res.elapsedMs,
        commands: res.commands || [],
        output: res.output.slice(-4000),
      },
      isError: false,
    };
  }

  async applySnapshot(
    args: Record<string, any>,
  ): Promise<SnapshotWorkflowResult> {
    const snapshot = String(args?.snapshot || "").trim();
    const check = !!args?.check;
    const reverse = !!args?.reverse;
    if (!snapshot) {
      return { text: "Missing snapshot", isError: true };
    }
    if (process.env.ALLOW_SNAPSHOT_APPLY !== "1") {
      return {
        text: "apply_snapshot is disabled. Set ALLOW_SNAPSHOT_APPLY=1 to enable.",
        isError: true,
      };
    }
    try {
      const res = await overlayStore.applyToWorkingTree(snapshot, {
        check,
        reverse,
        workspaceRoot: this.workspaceRoot,
      });
      return {
        payload: {
          snapshot,
          ok: res.ok,
          elapsedMs: res.elapsedMs,
          output: res.output.slice(-4000),
        },
        isError: !res.ok,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { text: `apply_snapshot failed: ${msg}`, isError: true };
    }
  }

  async patchChecksInSnapshot(
    args: Record<string, any>,
  ): Promise<SnapshotWorkflowResult> {
    const patch = String(args?.patch || "");
    if (!patch) return { text: "patch required", isError: true };
    const commands = Array.isArray(args?.commands)
      ? (args.commands as string[])
      : ["bun run typecheck"];
    const timeoutSec =
      typeof args?.timeoutSec === "number" ? args.timeoutSec : 240;
    const files = extractFilesFromPatch(patch);
    const impactSummary =
      args?.impactSummary && typeof args.impactSummary === "object"
        ? args.impactSummary
        : null;
    const checkRecommendations =
      args?.recommendChecks === true
        ? recommendChecksPayload({
            patch,
            files,
            impactSummary,
            mode: "minimum",
          })
        : null;

    const requested =
      typeof args?.snapshot === "string" ? String(args.snapshot).trim() : "";
    let snapId: string | undefined = requested || undefined;
    if (!snapId) {
      const snap = await this.getSnapshot({ preferExisting: false });
      snapId = (asPayload(snap)?.snapshot ||
        asPayload(snap)?.id ||
        asPayload(snap)?.snapshot_id) as string | undefined;
    }
    if (!snapId) return { text: "failed to create snapshot", isError: true };

    const stage = await this.proposePatch({ snapshot: snapId, patch });
    const staged = asPayload(stage);
    if (stage?.isError || staged?.accepted !== true) {
      const snapshotArtifacts = snapshotArtifactLinks(snapId);
      const validationPlan = buildValidationPlan({
        workflow: "patch_checks_in_snapshot",
        mode: "preview_validate",
        snapshot: snapId,
        snapshotArtifacts,
        risk: classifyPatchRisk(patch),
        commands,
        checksOk: false,
        checksElapsedMs: null,
        checkCommands: [],
        checkRecommendations,
        impactSummary,
        applied: false,
        applyGuardSatisfied: false,
      });
      return {
        payload: {
          workflow: "patch_checks_in_snapshot",
          ok: false,
          reason: "patch_stage_failed",
          snapshot: snapId,
          stage: staged,
          checkRecommendations,
          validationPlan,
          checks: null,
          next_actions: ["Fix patch staging errors; checks were not run"],
        },
        isError: false,
      };
    }
    const checks = await this.runChecks({
      snapshot: snapId,
      commands,
      timeoutSec,
    });
    const checksOut = asPayload(checks);
    const ok = !!checksOut?.ok;
    const snapshotArtifacts = snapshotArtifactLinks(snapId);
    const validationPlan = buildValidationPlan({
      workflow: "patch_checks_in_snapshot",
      mode: "preview_validate",
      snapshot: snapId,
      snapshotArtifacts,
      risk: classifyPatchRisk(patch),
      commands,
      checksOk: ok,
      checksElapsedMs: checksOut?.elapsedMs || null,
      checkCommands: Array.isArray(checksOut?.commands)
        ? checksOut.commands
        : [],
      checkRecommendations,
      impactSummary,
      applied: false,
      applyGuardSatisfied: false,
    });
    return {
      payload: {
        workflow: "patch_checks_in_snapshot",
        ok,
        snapshot: snapId,
        stage: staged,
        checkRecommendations,
        validationPlan,
        checks: checksOut,
        next_actions: ok
          ? ["Apply patch in working tree"]
          : ["Review failing checks; adjust and re-run"],
      },
      isError: false,
    };
  }

  async applyAfterChecks(
    args: Record<string, any>,
  ): Promise<SnapshotWorkflowResult> {
    const patch = typeof args?.patch === "string" ? args.patch : "";
    if (!patch.trim()) return { text: "patch required", isError: true };
    const commands = Array.isArray(args?.commands)
      ? (args.commands as string[])
      : ["bun run typecheck"];
    const timeoutSec =
      typeof args?.timeoutSec === "number" ? args.timeoutSec : 240;
    const reverse = !!args?.reverse;
    const requested =
      typeof args?.snapshot === "string" ? String(args.snapshot).trim() : "";
    let snapshot: string | undefined = requested || undefined;
    if (!snapshot) {
      const snapRes = await this.getSnapshot({ preferExisting: false });
      const snapTxt = asPayload(snapRes);
      snapshot = (snapTxt?.snapshot || snapTxt?.id) as string | undefined;
    }
    if (!snapshot) return { text: "failed to create snapshot", isError: true };

    const stage = await this.proposePatch({ snapshot, patch });
    const stageOut = asPayload(stage) || {};
    if (stage?.isError || stageOut?.accepted !== true) {
      return {
        payload: {
          ok: false,
          reason: "patch_stage_failed",
          snapshot,
          applied: false,
          stage: stageOut,
          output_tail: "",
        },
        isError: false,
      };
    }
    const checks = await this.runChecks({ snapshot, commands, timeoutSec });
    const chk = asPayload(checks) || {};
    if (chk?.ok && process.env.ALLOW_SNAPSHOT_APPLY === "1") {
      const app = await this.applySnapshot({ snapshot, check: false, reverse });
      const appOut = asPayload(app) || {};
      return {
        payload: {
          ok: !!chk?.ok,
          snapshot,
          applied: !!appOut?.ok,
          output_tail: chk?.output?.slice?.(-4000) || "",
        },
        isError: false,
      };
    }
    return {
      payload: {
        ok: !!chk?.ok,
        snapshot,
        applied: false,
        output_tail: chk?.output?.slice?.(-4000) || "",
      },
      isError: false,
    };
  }

  async safeWrite(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
    const patch = typeof args?.patch === "string" ? args.patch : "";
    if (!patch.trim()) return { text: "patch required", isError: true };
    const commands = Array.isArray(args?.commands)
      ? (args.commands as string[])
      : ["bun run typecheck"];
    const timeoutSec =
      typeof args?.timeoutSec === "number" ? args.timeoutSec : 240;
    const apply = args?.apply === true;
    const brief = args?.brief === true;
    const risk = classifyPatchRisk(patch);
    const impactSummary =
      args?.impactSummary && typeof args.impactSummary === "object"
        ? args.impactSummary
        : null;
    const checkRecommendations =
      args?.recommendChecks === true
        ? recommendChecksPayload({
            patch,
            files: risk.files,
            impactSummary,
            mode: "minimum",
          })
        : null;
    const requested =
      typeof args?.snapshot === "string" ? String(args.snapshot).trim() : "";
    let snapshot: string | undefined = requested || undefined;
    if (!snapshot) {
      const snapRes = await this.getSnapshot({ preferExisting: false });
      const snapTxt = asPayload(snapRes);
      snapshot = (snapTxt?.snapshot || snapTxt?.id) as string | undefined;
    }
    if (!snapshot) return { text: "failed to create snapshot", isError: true };

    const stage = await this.proposePatch({ snapshot, patch });
    const stageOut = asPayload(stage) || {};
    if (stage?.isError || stageOut?.accepted !== true) {
      const snapshotArtifacts = snapshotArtifactLinks(snapshot);
      const verification = {
        staged: false,
        checksPassed: false,
        applyGuardSatisfied: !apply || process.env.ALLOW_SNAPSHOT_APPLY === "1",
        applied: false,
        appliedDiffMatchesSnapshot: null,
        method: null,
        diagnostics: { reason: "patch_stage_failed" },
      };
      const validationPlan = buildValidationPlan({
        workflow: "safe_write",
        mode: apply ? "apply_after_checks" : "preview_validate",
        snapshot,
        snapshotArtifacts,
        risk,
        commands,
        checksOk: false,
        checksElapsedMs: null,
        checkCommands: [],
        checkRecommendations,
        impactSummary,
        applied: false,
        applyGuardSatisfied: verification.applyGuardSatisfied,
        rollback: null,
        verification,
      });
      const payload = {
        ok: false,
        workflow: "safe_write",
        mode: apply ? "apply_after_checks" : "preview_validate",
        reason: "patch_stage_failed",
        risk,
        snapshot,
        stage: stageOut,
        checkRecommendations,
        validationPlan,
        checks: null,
        verification,
        applied: false,
        snapshotArtifacts,
        next: "fix patch staging errors before running checks",
        next_actions: [
          "Fix patch staging errors",
          `Open snapshot status: ${snapshotArtifacts.status}`,
        ],
      };
      return {
        payload: brief
          ? {
              ok: false,
              workflow: "safe_write",
              reason: "patch_stage_failed",
              snapshot,
              validationPlan,
              verification,
              applied: false,
            }
          : payload,
        isError: false,
      };
    }
    const checks = await this.runChecks({ snapshot, commands, timeoutSec });
    const checksOut = asPayload(checks) || {};
    let applied = false;
    let applyResult: any = null;
    if (apply) {
      if (process.env.ALLOW_SNAPSHOT_APPLY === "1" && checksOut?.ok) {
        const app = await this.applySnapshot({ snapshot, check: false });
        applyResult = asPayload(app) || {};
        applied = !!applyResult?.ok;
      } else {
        applyResult = {
          ok: false,
          message:
            process.env.ALLOW_SNAPSHOT_APPLY === "1"
              ? "checks_failed"
              : "ALLOW_SNAPSHOT_APPLY=1 required",
        };
      }
    }
    const snapshotArtifacts = snapshotArtifactLinks(snapshot);
    const applyVerification = applied
      ? await this.verifyAppliedSnapshotDiff(snapshot)
      : null;
    const verification = {
      staged: !!stageOut?.accepted,
      checksPassed: !!checksOut?.ok,
      applyGuardSatisfied: !apply || process.env.ALLOW_SNAPSHOT_APPLY === "1",
      applied,
      appliedDiffMatchesSnapshot: applied
        ? applyVerification?.appliedDiffMatchesSnapshot === true
        : null,
      method: applied
        ? applyVerification?.method ||
          "git_apply_reverse_check_vs_snapshot_overlay"
        : null,
      diagnostics: applied ? applyVerification?.diagnostics || null : null,
    };
    const ok =
      !!stageOut?.accepted &&
      !!checksOut?.ok &&
      (apply
        ? applied && verification.appliedDiffMatchesSnapshot === true
        : true);
    const rollbackArgs = JSON.stringify({ snapshot, reverse: true });
    const rollback = {
      available: !!snapshot,
      strategy: "reverse_snapshot_apply",
      command: `cd ${shellQuote(this.workspaceRoot)} && ALLOW_SNAPSHOT_APPLY=1 semantic-code-intelligence workflow apply_snapshot --args ${shellQuote(rollbackArgs)} --json`,
      artifact: snapshotArtifacts.overlayDiff,
    };
    const validationPlan = buildValidationPlan({
      workflow: "safe_write",
      mode: apply ? "apply_after_checks" : "preview_validate",
      snapshot,
      snapshotArtifacts,
      risk,
      commands,
      checksOk: !!checksOut?.ok,
      checksElapsedMs: checksOut?.elapsedMs || null,
      checkCommands: Array.isArray(checksOut?.commands)
        ? checksOut.commands
        : [],
      checkRecommendations,
      impactSummary,
      applied,
      applyGuardSatisfied: verification.applyGuardSatisfied,
      rollback,
      verification,
    });
    const summary = {
      ok,
      workflow: "safe_write",
      mode: apply ? "apply_after_checks" : "preview_validate",
      risk,
      snapshot,
      checkRecommendations,
      validationPlan,
      checks: {
        ok: !!checksOut?.ok,
        commands: Array.isArray(checksOut?.commands) ? checksOut.commands : [],
        elapsedMs: checksOut?.elapsedMs || null,
      },
      verification,
      applied,
      next: applied
        ? "review git diff; rollback artifact available"
        : "inspect snapshot artifact; set apply:true with ALLOW_SNAPSHOT_APPLY=1 only when ready",
    };
    const payload = brief
      ? summary
      : {
          ...summary,
          stage: stageOut,
          verification,
          snapshotArtifacts,
          rollback,
          applyResult,
          checks: {
            ...summary.checks,
            output: String(checksOut?.output || "").slice(-4000),
          },
          next_actions: applied
            ? [
                "Review working tree diff",
                `Rollback if needed: ${rollback.command}`,
              ]
            : [
                `Open snapshot diff: ${snapshotArtifacts.overlayDiff}`,
                "Re-run safe_write with apply:true only after review and with ALLOW_SNAPSHOT_APPLY=1",
              ],
        };
    return { payload, isError: false };
  }

  async verifyAppliedSnapshotDiff(snapshot: string): Promise<{
    appliedDiffMatchesSnapshot: boolean;
    method: string;
    diagnostics: Record<string, unknown>;
  }> {
    const method = "git_diff_patch_id_and_reverse_check_vs_snapshot_overlay";
    try {
      const existingDiff = (overlayStore as any).getExistingMaterializedDiffPath?.bind(
        overlayStore,
      );
      const diffFile = existingDiff
        ? existingDiff(snapshot, { workspaceRoot: this.workspaceRoot })
        : path.resolve(
            this.workspaceRoot,
            ".ontology",
            "snapshots",
            snapshot,
            "overlay.diff",
          );
      const diffStat = await fs.stat(diffFile).catch(() => null);
      if (!diffStat?.isFile()) {
        return {
          appliedDiffMatchesSnapshot: false,
          method,
          diagnostics: {
            reason: "snapshot_overlay_diff_unavailable",
            snapshot,
            diffFile,
          },
        };
      }

      const overlayDiff = await fs.readFile(diffFile, "utf8");
      const status = overlayStore.getStatus(snapshot, {
        workspaceRoot: this.workspaceRoot,
      });
      const touchedFiles = Array.isArray(status?.touchedFiles)
        ? status.touchedFiles.filter(
            (file: unknown): file is string =>
              typeof file === "string" && file.length > 0,
          )
        : [];
      if (touchedFiles.length === 0) {
        return {
          appliedDiffMatchesSnapshot: false,
          method,
          diagnostics: {
            reason: "snapshot_touched_files_unavailable",
            snapshot,
            diffFile,
          },
        };
      }

      const workingDiffProc = spawnSync(
        "git",
        ["diff", "--no-ext-diff", "--", ...touchedFiles],
        {
          cwd: this.workspaceRoot,
          stdio: "pipe",
          encoding: "utf8",
        },
      );
      const workingDiff = String(workingDiffProc.stdout || "");
      if (workingDiffProc.status !== 0) {
        return {
          appliedDiffMatchesSnapshot: false,
          method,
          diagnostics: {
            reason: "working_tree_diff_failed",
            snapshot,
            files: touchedFiles,
            exitCode: workingDiffProc.status,
            stderr: String(workingDiffProc.stderr || "").slice(-2000),
          },
        };
      }

      const patchId = (diff: string) => {
        const proc = spawnSync("git", ["patch-id", "--stable"], {
          cwd: this.workspaceRoot,
          input: diff,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf8",
        });
        const output = `${proc.stdout || ""}${proc.stderr || ""}`;
        const id =
          String(proc.stdout || "")
            .trim()
            .split(/\s+/)[0] || null;
        return {
          ok: proc.status === 0 && !!id,
          id,
          outputTail: output.slice(-2000),
        };
      };

      const overlayPatchId = patchId(overlayDiff);
      const workingPatchId = patchId(workingDiff);

      const reverse = spawnSync(
        "git",
        ["apply", "--check", "-R", "--whitespace=nowarn", diffFile],
        { cwd: this.workspaceRoot, stdio: "pipe", encoding: "utf8" },
      );
      const reverseOk = reverse.status === 0;
      const patchIdsMatch =
        overlayPatchId.ok &&
        workingPatchId.ok &&
        !!overlayPatchId.id &&
        overlayPatchId.id === workingPatchId.id;
      return {
        appliedDiffMatchesSnapshot: reverseOk && patchIdsMatch,
        method,
        diagnostics: {
          snapshot,
          diffFile,
          files: touchedFiles,
          reverseApplyCheckOk: reverseOk,
          overlayPatchId: overlayPatchId.id || null,
          workingPatchId: workingPatchId.id || null,
          patchIdsMatch,
          workingDiffBytes: Buffer.byteLength(workingDiff, "utf8"),
          overlayDiffBytes: Buffer.byteLength(overlayDiff, "utf8"),
          reverseCheckTail:
            `${reverse.stdout || ""}${reverse.stderr || ""}`.slice(-2000),
          patchIdOutputTail: !overlayPatchId.ok
            ? overlayPatchId.outputTail
            : !workingPatchId.ok
              ? workingPatchId.outputTail
              : "",
        },
      };
    } catch (error) {
      return {
        appliedDiffMatchesSnapshot: false,
        method,
        diagnostics: {
          reason: "verification_exception",
          snapshot,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

function asPayload(result: SnapshotWorkflowResult | undefined): any {
  if (!result) return result;
  return "payload" in result ? result.payload : result;
}
