# project-context-sync

Automatic project context synchronization for long-running Claude Code sessions.

Based on patterns from [Anthropic's research on effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## The Problem

When AI agents work across multiple sessions, each new session starts with no memory of what came before. This leads to:

- **One-shotting**: Trying to do too much at once, leaving half-implemented features
- **Premature completion**: Declaring victory without proper documentation
- **Context loss**: Previous decisions and rationale forgotten
- **Repeated mistakes**: Re-discovering issues that were already solved

## The Solution

This plugin implements a two-part solution:

1. **Structural state** (git): What code exists, what changed
2. **Semantic state** (PROGRESS.md): Why changes were made, what was attempted, what's next

Together, these form a complete picture that bridges sessions.

## How It Works

### Deterministic Hooks

| Hook | Behavior |
|------|----------|
| `SessionStart` | Injects PROGRESS.md + git history, validates schema |
| `PostToolUse` | Tracks file modifications (session-isolated) |
| `PreCompact` | Prompts context update before memory compaction |
| `Stop` (pre-validate) | Machine-readable validation of PROGRESS.md |
| `Stop` (prompt) | LLM evaluation with validation summary |
| `SubagentStop` | Ensures subagents document their work |
| `SessionEnd` | Spawns `claude -p --resume` with duplicate prevention |

### v1.1 Improvements

1. **SessionEnd lock file**: Prevents duplicate executions (5-second window)
2. **Session ID isolation**: Modifications tracked per-session, not globally
3. **Pre-validation for Stop hook**: Machine-readable summary injected into prompt
4. **PROGRESS.md schema validation**: Checks for required sections, offers repair templates
5. **Git repo validation**: Graceful handling of non-git directories

### Model-Invoked Skill

The `project-context-sync` skill provides guidance on:
- Reading and updating PROGRESS.md
- Working incrementally (one feature at a time)
- Leaving clean handoffs for future sessions

### Slash Commands

- `/sync-context` - Force synchronization of project context
- `/whats-next` - Show prioritized next actions

### Agent

- `context-auditor` - Validates documentation accuracy against code state

## Installation

### From Local Directory

```bash
claude /plugin add /path/to/project-context-sync
```

### Enable for a Project

The plugin activates automatically when enabled. To customize behavior, create `.claude/context-sync.json`:

```json
{
  "enabled": true,
  "sessionEndSync": true,
  "syncTimeout": 180,
  "maxTurns": 5,
  "minModificationsForSync": 1,
  "requireProgressFile": false,
  "gitHistoryLines": 10,
  "showFullProgress": true,
  "quietStart": false
}
```

## Usage

### First Session

1. Plugin detects no `.claude/PROGRESS.md`
2. SessionStart injects guidance on creating one
3. Run `/sync-context` or ask Claude to initialize context
4. Claude creates PROGRESS.md with project overview and initial plan

### Subsequent Sessions

1. `SessionStart` hook injects context with schema validation
2. Claude reads PROGRESS.md and git history
3. Work on ONE prioritized task
4. `Stop` hook validates documentation before allowing exit

### Stop Hook Validation

The Stop hook now runs in two phases:

1. **Pre-validation** (`validate-progress.js`): Generates machine-readable summary
   - Checks PROGRESS.md exists
   - Validates required sections present
   - Counts commits since last update
   - Lists files modified this session
   - Provides repair template if sections missing

2. **LLM Evaluation**: Receives validation summary in context
   - Makes informed decision based on facts, not introspection
   - Can reference specific issues from validation
   - Blocks with actionable feedback

### SessionEnd Behavior

The `SessionEnd` hook uses `--resume` to continue with the same session context:
- Lock file prevents duplicate executions (5-second window)
- Only runs if Stop hook didn't finalize (checks session ID)
- Only runs if there's uncommitted work or modifications
- Uses minimal turns (default: 5)
- Hard timeout (default: 180s)
- Validates git repo before running git commands

## File Structure

```
.claude/
├── PROGRESS.md              # Semantic state (required for full benefit)
├── features.json            # Feature tracking (optional)
├── context-sync.json        # Plugin config (optional)
├── .context-state/          # Internal state (managed by plugin)
│   ├── current-session.json # Session tracking with ID
│   ├── modifications.json   # Session-isolated modification tracking
│   └── .session-end.lock    # Duplicate execution prevention
└── logs/                    # SessionEnd logs (for debugging)
```

## PROGRESS.md Required Sections

The plugin validates these sections exist:

- **Current State**: What's working, what's broken
- **Recent Work**: What was done recently and why
- **Next Steps**: Prioritized list of what to work on

If sections are missing, the validation output includes a repair template.

## Design Rationale

### Why Machine Pre-Validation for Stop Hook

Relying solely on LLM introspection for "is documentation current?" is fragile. The model can:
- Hallucinate that PROGRESS.md is up to date
- Miss that commits happened after the last update
- Approve despite missing sections

The pre-validation script provides facts the LLM can't deny:
- Exact count of commits since last PROGRESS.md update
- List of files modified this session
- Boolean checks for required sections

### Why Session ID Isolation

Without session isolation, concurrent tabs or rapid session restarts cause:
- Modifications from session A polluting session B's tracking
- Stop hook approving based on stale modification data
- SessionEnd spawning cleanup for wrong session

Each session now tracks its own modifications and validates against its own ID.

### Why Lock File for SessionEnd

Claude Code v2.x has a known issue where hooks can fire multiple times. The lock file pattern (from dev-gom's hook-session-summary) prevents:
- Multiple background `claude -p` processes spawning
- Race conditions in state files
- Duplicate documentation updates

## Limitations

- **Hooks can't force mid-session updates**: Stop hook creates backpressure, but can't force updates during work
- **PreCompact timing**: May not catch all cases before compaction
- **SessionEnd is best-effort**: Background process may fail silently (check logs)
- **Non-git projects**: Less context available, but still tracks modifications

## See Also

- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Claude Code Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Agent Skills](https://docs.anthropic.com/en/docs/claude-code/skills)

## Changelog

### v1.1.0
- Added timestamp-based lock file for SessionEnd duplicate prevention
- Added session_id isolation for modification tracking
- Added validate-progress.js pre-validation script for Stop hook
- Added PROGRESS.md schema validation with repair templates
- Added git repo detection before running git commands
- Improved context markers for model salience
- Updated Stop hook prompt to use validation summary

### v1.0.0
- Initial release

## License

MIT
