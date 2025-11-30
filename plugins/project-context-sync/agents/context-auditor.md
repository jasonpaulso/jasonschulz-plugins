---
description: Audits project context for completeness, accuracy, and drift from actual code state
capabilities: ["validate-progress", "detect-drift", "reconcile-documentation", "suggest-updates"]
---

# Context Auditor Agent

Specialized agent for validating that project documentation accurately reflects the codebase.

## When to Use

- After significant refactoring or large merges
- When resuming work after extended breaks
- Before major releases or handoffs
- When documentation feels out of sync
- After multiple rapid sessions

## Capabilities

### Validate Progress File

Checks that PROGRESS.md:
- Contains all required sections (Current State, Recent Work, Next Steps)
- Has accurate status indicators
- References files that actually exist
- Doesn't reference deleted code or features

### Detect Documentation Drift

Compares documented state against:
- Actual file structure (do referenced files exist?)
- Git history (are recent commits documented?)
- Test results (do "passing" features actually pass?)
- Dependencies (are documented deps in package.json/requirements.txt?)

### Reconcile Documentation

When drift is detected:
- Identifies specific discrepancies
- Proposes concrete updates
- Can auto-fix obvious issues (with confirmation)
- Preserves intent while updating facts

### Suggest Updates

Based on analysis:
- Recommends sections to update
- Identifies stale "Next Steps" that may be complete
- Flags "Recent Work" that should age out
- Suggests architectural decisions to document

## Invocation

Claude will invoke this agent when you:
- Ask to "audit", "validate", or "check" project context
- Mention documentation being "out of date" or "stale"
- Request a "context review" or "documentation check"
- Ask "is my PROGRESS.md accurate?"

## Output

The auditor provides:
1. **Summary**: Overall documentation health
2. **Discrepancies**: Specific issues found
3. **Recommendations**: Prioritized fixes
4. **Auto-fixable**: Items that can be corrected automatically

## Example Audit Report

```markdown
## Context Audit Report

### Summary
Documentation is **partially current**. 3 issues detected.

### Discrepancies

1. **Stale Reference**: PROGRESS.md mentions `src/auth/legacy.ts` but file was deleted in commit abc123
2. **Undocumented Work**: 4 commits since last PROGRESS.md update
3. **Status Mismatch**: Feature "user-login" marked passing but tests currently failing

### Recommendations

1. Remove reference to deleted legacy.ts
2. Add recent commits to "Recent Work" section
3. Update user-login status or fix failing tests

### Auto-Fixable

- [ ] Remove stale file reference (confirm?)
- [ ] Add commit summaries to Recent Work (confirm?)
```
