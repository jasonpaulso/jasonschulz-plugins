---
description: Show prioritized next actions from project context
allowed-tools: Read, Bash(git:*)
---

# What's Next

Display the current priority task and context for starting work.

## Steps

1. Read `.claude/PROGRESS.md`
2. Read `.claude/features.json` if it exists
3. Check `git status` for any uncommitted work from previous session
4. Check `git stash list` for any stashed changes

## Output Format

```
## Priority Task
[Top item from Next Steps]

## Context
[Relevant details from PROGRESS.md]

## Uncommitted Work
[If any exists from previous session]

## Blockers
[If any]

## Ready to Start?
[Brief confirmation or any setup needed]
```

## If No PROGRESS.md Exists

Suggest running `/sync-context` first to initialize project tracking.
