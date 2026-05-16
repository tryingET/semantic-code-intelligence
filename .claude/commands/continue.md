---
description: Continue work on project following standard workflow
allowed-tools: Read, Write, Edit, MultiEdit, TodoWrite, Bash, Grep, Glob, LS, WebSearch, WebFetch, Task
---

## Session Workflow - Continue Development

Follow this workflow to continue development on the Ontology-LSP project:

### 1. Initialize Context
Read the following documents in order to understand the current state:
- Read VISION.md to understand the project goals
- Read PROJECT_STATUS.md to understand current state  
- Read NEXT_STEPS.md to see what needs to be done

### 2. Create Task List
- Use TodoWrite to create a task list based on NEXT_STEPS.md
- Each task should be specific and achievable
- Start with all tasks as "pending"

### 3. Execute Tasks Using Task Tool
For each task in the list:
- Mark task as "in_progress" in TodoWrite
- **Use the Task tool with subagent_type: "general-purpose"** to handle the task with full context:
  - Include all relevant file paths and error messages from NEXT_STEPS.md
  - Specify exact test commands to run
  - Include expected outcomes and success criteria
  - Provide context about the system architecture from PROJECT_STATUS.md
- Wait for Task agent to complete and report results
- Update PROJECT_STATUS.md with what was accomplished
- Update NEXT_STEPS.md (remove completed items, add new discoveries)  
- Mark task as "completed" in TodoWrite
- Report the Task agent's findings

### 4. Handle Results
After each task:
- If task failed: Update TodoWrite with why it failed and what needs to be fixed
- If task succeeded: Continue to next task
- If new issues discovered: Add them to TodoWrite

### 5. Session Completion
At the end of the session:
- Update PROJECT_STATUS.md with final state
- Update NEXT_STEPS.md with remaining work
- Provide summary of:
  - What was accomplished
  - What's still broken
  - What should be done next session

## Important Rules
- Always update documentation after EACH task, not at the end
- If something doesn't work, document WHY in PROJECT_STATUS.md
- Keep NEXT_STEPS.md focused on actionable items only
- Test everything before marking as complete
- Report specific error messages and file locations
- Use `just dev` to start servers, `just logs` to check logs
- Use `just stop` before cleaning up database files

## Test Suite Validation
Use this validation flow before marking any task as completed. For significant changes (core, adapters, performance), run the full validation.

### Baseline (per task)
- Run `just check` to format, lint, typecheck, and run unit tests.
- Run core tests: `just test` (covers step tests and integration basics).
- Capture logs: `bun test --bail=1 > test-output.txt 2>&1` (attach failures to PROJECT_STATUS.md).

### Full Validation (major changes)
- All tests: `just test-all` (includes comprehensive integration and extension tests).
- Vision compliance: `just test-vision-compliance` (validates VISION.md guarantees).
- Optional E2E: `just test-e2e-local` (runs end-to-end scenarios locally).

### Targeted Repro (fast feedback)
- Stop at first failure: `bun test --bail=1`.
- Single suite: `bun test tests/unified-core.test.ts`.
- Performance: `bun test tests/performance.test.ts --timeout 180000`.
- File-URI: `bun test tests/file-uri-resolution.test.ts --bail=1`.

### Artifacts
- Full logs: `test-output.txt` (latest run; referenced in PROJECT_STATUS.md and NEXT_STEPS.md).
- JUnit (optional/CI): `bun test --reporter=junit --reporter-outfile report.xml`.

### Acceptance Criteria
- Baseline: No failing tests in `just test` and `just check`.
- Full validation (when required): `just test-all` passes, or any failure is documented with reproduction steps and tracked in NEXT_STEPS.md under “Test Suite Stabilization”.
- Flaky performance benchmarks: acceptable with note; rerun up to 2x. If still flaky, add an action in NEXT_STEPS.md to tune Layer 1 budgets or use deterministic fixtures.
- Update docs on every run:
  - PROJECT_STATUS.md: summarize pass/fail counts and notable changes; link `test-output.txt`.
  - NEXT_STEPS.md: add any failures with exact command, failing test name, and error snippet.

## Execution Example
When executing tasks, use the Task tool like this:

```
For task "Fix database schema issues":
Task(
  subagent_type="general-purpose",
  description="Fix database schema", 
  prompt="""
  Fix the missing signature_fingerprint column issue in the database schema.
  
  Context:
  - Error location: src/core/services/shared-services.ts:81
  - The column is defined in database-service.ts but SharedServices may be using an old schema
  - Database files are in .ontology/ directory
  
  Steps to fix:
  1. Check database-service.ts line 35 for the signature_fingerprint column definition
  2. Verify SharedServices is using the correct schema
  3. Clean up old database files: rm -rf .ontology/*.db*
  4. Test fresh initialization with: just dev
  5. Verify schema with: sqlite3 .ontology/ontology.db ".schema concepts"
  
  Expected outcome: Database initializes without errors and all services start successfully.
  """
)
```

## Start Now
Begin by reading the three documents (VISION.md, PROJECT_STATUS.md, NEXT_STEPS.md) and creating your TodoWrite list. Then use the Task tool for each item with detailed context.
