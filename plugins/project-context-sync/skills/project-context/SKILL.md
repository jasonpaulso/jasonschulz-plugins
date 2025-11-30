---
name: project-context-sync
description: |
  Maintains synchronized project context for long-running work across sessions.
  Use when: starting a session (read context), completing significant work (update context),
  making architectural decisions (document rationale), or before stopping work (ensure clean handoff).
  Triggers on: "continue working", "what's next", "resume", "pick up where", "context", "progress",
  "document", "handoff", "session", "PROGRESS.md"
---

# Project Context Synchronization

This skill ensures Claude maintains accurate project state across sessions, following patterns from Anthropic's long-running agent research.

## Core Philosophy

Each session should:
1. **Start informed**: Read existing context before diving in
2. **Work incrementally**: One feature at a time, commit often
3. **End clean**: Leave documentation that your future self (next session) can understand

## Context Files

### .claude/PROGRESS.md

This is the **semantic bridge** between sessions. It answers: "What was I doing? What's next?"

Required sections:
- **Current State**: What's working, what's broken
- **Recent Work**: Last 3-5 significant changes with rationale
- **Next Steps**: Prioritized list of what to work on
- **Blockers** (optional): Known issues or decisions needed
- **Architecture Decisions** (optional): Why significant choices were made

### .claude/features.json (Optional)

For larger projects, track feature completion:

```json
{
  "features": [
    {
      "id": "auth-001",
      "description": "User can log in with email/password",
      "status": "passing",
      "tested": "2025-01-15",
      "notes": "Uses JWT, tokens stored in httpOnly cookie"
    }
  ]
}
```

Use JSON (not Markdown) for structured data that shouldn't be casually edited.

### .claude/context-sync.json (Optional)

Plugin configuration:

```json
{
  "enabled": true,
  "sessionEndSync": true,
  "syncTimeout": 180,
  "maxTurns": 5,
  "requireProgressFile": false,
  "gitHistoryLines": 10,
  "showFullProgress": true,
  "quietStart": false
}
```

## Session Workflow

### On Session Start

The plugin automatically injects context, but you should:

1. **Orient yourself**: Review the injected PROGRESS.md and git history
2. **Verify environment**: Run any init scripts if they exist
3. **Choose ONE task**: Pick the highest-priority incomplete item
4. **Announce your plan**: State what you'll work on this session

### During Work

- **Commit incrementally**: After each logical unit of work
- **Use descriptive messages**: Future sessions read these
- **Test before moving on**: Verify changes work end-to-end
- **Update PROGRESS.md**: After completing significant milestones

### Before Stopping

The Stop hook will verify, but proactively:

1. **Commit all changes**: No uncommitted work
2. **Update PROGRESS.md**:
   - What was accomplished
   - Current state of in-progress work
   - Updated next steps
3. **No half-implementations**: Either complete a feature or clearly document partial state

## PROGRESS.md Template

```markdown
# Project Progress

## Current State

**Status**: [Working | Partially Working | Broken]

[Brief description of current project state]

## Recent Work

### [Date] - [Summary]
- What was done
- Why it was done
- Any issues encountered

### [Earlier Date] - [Summary]
- ...

## Next Steps

1. **[Priority]** [Task description]
   - Details or subtasks
   
2. **[Priority]** [Task description]
   - ...

## Blockers

- [Issue]: [What's blocking, what decision is needed]

## Architecture Decisions

### [Decision Name]
- **Context**: Why this decision was needed
- **Decision**: What was chosen
- **Consequences**: Trade-offs accepted
```

## Commands

- `/sync-context` - Force synchronize context (read + update)
- `/whats-next` - Show prioritized next actions

## Best Practices

### Commit Messages
Write for your future self:
- Bad: "fix bug"
- Good: "Fix auth token refresh failing after 24h - was comparing timestamps in wrong timezone"

### Progress Updates
Be specific:
- Bad: "Worked on auth"
- Good: "Implemented password reset flow. Email sending works, but reset link expiration not yet tested."

### Incremental Work
From Anthropic's research: "Ask the model to work on only one feature at a time."

If a task is too large for one session:
1. Break it into subtasks
2. Document subtasks in PROGRESS.md
3. Complete and commit subtasks individually
4. Mark overall task as "in progress" with completed subtasks noted

## Integration with Git

This skill complements git, not replaces it:
- **Git**: What changed (code)
- **PROGRESS.md**: Why it changed, what's next (intent)

Together they form a complete picture for the next session.
