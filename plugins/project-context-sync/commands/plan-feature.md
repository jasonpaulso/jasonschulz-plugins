---
description: Plan a feature into session-sized work items with verification criteria
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
---

# Plan Feature

Break down a feature into session-sized work items with clear acceptance criteria and verification commands.

## Purpose

This command implements the "initializer agent" pattern from Anthropic's long-running agent research. It produces a `feature_list.json` that:
- Guides subsequent coding sessions
- Provides clear start/finish boundaries
- Enables automated verification

## Input

The command argument should describe the feature:
```
/plan-feature Add user authentication with JWT tokens
```

Or reference a ticket:
```
/plan-feature BUSIE-2360 Modernize framework stack
```

## Workflow

### Phase 1: Discovery

1. **Understand the request**
   - Parse feature description or fetch Jira ticket details
   - Identify scope and success criteria
   - Note any constraints or requirements

2. **Explore the codebase**
   - Use Glob to find relevant files
   - Use Grep to understand existing patterns
   - Read key files to understand architecture
   - Identify integration points

3. **Assess complexity**
   - Simple: 1-2 sessions, single component
   - Medium: 3-5 sessions, multiple components
   - Complex: 5+ sessions, cross-cutting concerns
   - Epic: Requires breaking into sub-features

### Phase 2: Architecture

4. **Design the approach**
   - Identify components to create/modify
   - Note dependencies between changes
   - Consider testing strategy
   - Document technical decisions

5. **Identify risks**
   - Breaking changes
   - Performance implications
   - Security considerations
   - Migration requirements

### Phase 3: Work Item Creation

6. **Break into work items**

   Each work item should be:
   - **Session-sized**: Completable in one session (~2-4 hours of context)
   - **Self-contained**: Clear start and finish
   - **Testable**: Has verification commands
   - **Ordered**: Dependencies respected

   Work item structure:
   ```json
   {
     "id": "item-001",
     "description": "Create auth middleware",
     "status": "pending",
     "acceptanceCriteria": [
       "Middleware validates JWT tokens",
       "Invalid tokens return 401",
       "Valid tokens attach user to request"
     ],
     "verification": [
       {
         "command": "npm test -- --grep 'auth middleware'",
         "description": "Unit tests pass"
       },
       {
         "command": "curl -I http://localhost:3000/api/protected",
         "description": "Protected route returns 401 without token",
         "expectedOutput": "401"
       }
     ],
     "estimatedEffort": "medium",
     "dependencies": [],
     "notes": "Use existing jwt library, follow patterns in src/middleware/"
   }
   ```

7. **Define verification commands**

   Good verification commands:
   - `npm test` / `npm run test:unit` - Unit tests
   - `npm run lint` - Code style
   - `npm run typecheck` - Type safety
   - `npm run build` - Builds successfully
   - `curl` commands - API endpoints work
   - `grep -r "pattern" src/` - Code patterns exist
   - Custom scripts for integration tests

### Phase 4: Output

8. **Generate feature_list.json**

   Write to `.claude/feature_list.json`:
   ```json
   {
     "feature": "User Authentication",
     "description": "Add JWT-based authentication...",
     "created": "2025-01-15T10:00:00Z",
     "status": "planning",
     "estimatedSessions": 4,
     "completedSessions": 0,
     "items": [...],
     "metadata": {
       "complexity": "medium",
       "riskFactors": ["Breaking API changes"],
       "relatedFiles": ["src/auth/", "src/middleware/"],
       "dependencies": ["jsonwebtoken", "bcrypt"]
     }
   }
   ```

9. **Update PROGRESS.md**

   Add planning summary to Recent Work and first item to Next Steps.

## Output

After planning, provide:

```markdown
## Feature Plan: [Name]

**Complexity**: [simple|medium|complex|epic]
**Estimated Sessions**: N

### Work Items

1. **[item-001]** [Description] - [effort]
2. **[item-002]** [Description] - [effort]
   - Depends on: item-001
3. ...

### Risks Identified
- [Risk 1]
- [Risk 2]

### Ready to Start

First work item: **[item-001]** - [Description]

Verification commands ready. Run `/whats-next` to begin.
```

## Tips for Good Work Items

### Too Large (Bad)
- "Implement authentication" - Too vague, multiple sessions
- "Refactor the entire auth module" - Unclear scope

### Good Size
- "Create JWT token generation utility"
- "Add password hashing to user model"
- "Create login API endpoint with validation"
- "Add auth middleware to protected routes"
- "Write integration tests for auth flow"

### Verification Examples

For a new API endpoint:
```json
{
  "command": "npm test -- auth.test.ts",
  "description": "Auth tests pass"
},
{
  "command": "curl -X POST http://localhost:3000/api/login -d '{\"email\":\"test@test.com\",\"password\":\"test\"}' -H 'Content-Type: application/json'",
  "description": "Login endpoint responds",
  "expectedOutput": "token"
}
```

For a refactoring task:
```json
{
  "command": "npm run typecheck",
  "description": "No type errors"
},
{
  "command": "npm test",
  "description": "All existing tests still pass"
}
```

## Invoking the Feature Planner Agent

For complex features, this command may invoke the `feature-planner` agent for deeper exploration:

```
Use Task tool with subagent_type="feature-planner"
Prompt: "Explore and plan: [feature description]"
```

The agent will perform thorough codebase exploration before generating work items.
