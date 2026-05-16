# Session Prompt (MCP Clients)

Copy and paste this at the start of each session:

---

Please follow this workflow for our session:

1. **Read Project Context** (in this order):
   - Read VISION.md to understand the project goals
   - Read PROJECT_STATUS.md to understand current state
   - Read NEXT_STEPS.md to see what needs to be done

2. **Create Task List**:
   - Use TodoWrite to create a task list based on NEXT_STEPS.md
   - Each task should be specific and achievable
   - Start with all tasks as "pending"

3. **For Each Task**:
   - Mark task as "in_progress" before starting
   - Implement the task completely
   - Test/verify the implementation works
   - Update PROJECT_STATUS.md with what was accomplished
   - Update NEXT_STEPS.md (remove completed items, add new discoveries)
   - Mark task as "completed"
   - Report success/failure with specific details

4. **After Each Task**:
   - If task failed: Update TodoWrite with why it failed and what needs to be fixed
   - If task succeeded: Continue to next task
   - If new issues discovered: Add them to TodoWrite

5. **End of Session**:
   - Update PROJECT_STATUS.md with final state
   - Update NEXT_STEPS.md with remaining work
   - Provide summary of:
     - What was accomplished
     - What's still broken
     - What should be done next session

**Important Rules**:
- Always update documentation after EACH task, not at the end
- If something doesn't work, document WHY in PROJECT_STATUS.md
- Keep NEXT_STEPS.md focused on actionable items only
- Test everything before marking as complete
- Report specific error messages and file locations

Start by reading the three documents now and creating your TodoWrite list.
