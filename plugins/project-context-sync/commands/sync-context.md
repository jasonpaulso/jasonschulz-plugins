---
description: Synchronize project context - read current state and update PROGRESS.md
allowed-tools: Read, Write, Edit, Bash(git:*)
---

# Sync Project Context

Synchronize project documentation with actual code state.

## Steps

1. **Read current state**:
   - Read `.claude/PROGRESS.md` if it exists
   - Run `git log --oneline -10` for recent history
   - Run `git status` for uncommitted changes
   - Check `.claude/features.json` if it exists

2. **Analyze drift**:
   - Compare documented state to actual git history
   - Identify any undocumented recent work
   - Note any documented "in progress" items that may be complete

3. **Update PROGRESS.md**:
   - Create file if it doesn't exist (use template from skill)
   - Update "Current State" section
   - Move completed items to "Recent Work"
   - Refresh "Next Steps" based on current priorities
   - Clear any resolved blockers

4. **Report**:
   - Summarize what was updated
   - State the current priority task

## If PROGRESS.md Doesn't Exist

Create it with this structure:

```markdown
# Project Progress

## Current State

**Status**: [Assess based on git history and code state]

[Describe current project state based on analysis]

## Recent Work

[Populate from recent git commits]

## Next Steps

1. [Derive from context or ask user]

## Blockers

[None identified, or list any obvious issues]
```

## Output

After syncing, provide:
- Brief confirmation of what changed
- Current top priority
- Any blockers or decisions needed
