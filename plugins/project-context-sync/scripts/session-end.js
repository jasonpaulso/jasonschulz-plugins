#!/usr/bin/env node
/**
 * session-end.js (v1.1)
 *
 * Runs at SessionEnd to spawn background context finalization.
 * Uses --resume to continue with the same session context for coherent updates.
 *
 * v1.1 Changes:
 * - Added timestamp-based lock file to prevent duplicate executions
 * - Added git repo validation before running git commands
 * - Added session_id enforcement for modifications
 * - Better error handling and logging
 */

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const projectRoot = process.cwd();
const CLAUDE_DIR = path.join(projectRoot, ".claude");
const STATE_DIR = path.join(CLAUDE_DIR, ".context-state");
const LOG_DIR = path.join(CLAUDE_DIR, "logs");
const CONFIG_FILE = path.join(CLAUDE_DIR, "context-sync.json");
const LOCK_FILE = path.join(STATE_DIR, ".session-end.lock");

// Duplicate execution prevention window (milliseconds)
const LOCK_WINDOW_MS = 5000;

// Read hook input from stdin
let hookInput = {};
try {
  const input = fs.readFileSync(0, "utf8");
  if (input.trim()) {
    hookInput = JSON.parse(input);
  }
} catch (e) {
  process.exit(0);
}

/**
 * Check and acquire lock to prevent duplicate executions
 * Returns true if lock acquired, false if should skip
 */
function acquireLock() {
  const now = Date.now();

  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }

    if (fs.existsSync(LOCK_FILE)) {
      const lastRun = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
      if (!isNaN(lastRun) && now - lastRun < LOCK_WINDOW_MS) {
        // Hook ran too recently - likely duplicate execution
        return false;
      }
    }

    // Acquire lock
    fs.writeFileSync(LOCK_FILE, now.toString(), "utf8");
    return true;
  } catch (e) {
    // If lock handling fails, proceed anyway but log it
    logError(`Lock acquisition failed: ${e.message}`);
    return true;
  }
}

/**
 * Check if we're in a git repository
 */
function isGitRepo() {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Load plugin configuration
 */
function loadConfig() {
  const defaults = {
    enabled: true,
    sessionEndSync: true,
    syncTimeout: 180,
    maxTurns: 5,
    worktreeIsolation: false,
    minModificationsForSync: 1,
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return { ...defaults, ...userConfig };
    }
  } catch (e) {
    // Use defaults
  }

  return defaults;
}

/**
 * Check if context was already synced (Stop hook succeeded)
 */
function wasContextSynced(sessionId) {
  const sessionFile = path.join(STATE_DIR, "current-session.json");
  try {
    if (fs.existsSync(sessionFile)) {
      const session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      // Only consider synced if it's the same session
      if (sessionId && session.sessionId !== sessionId) {
        return false;
      }
      return session.contextSynced === true;
    }
  } catch (e) {
    // Assume not synced
  }
  return false;
}

/**
 * Get modifications for the current session only
 */
function getSessionModifications(sessionId) {
  const modsFile = path.join(STATE_DIR, "modifications.json");
  try {
    if (fs.existsSync(modsFile)) {
      const mods = JSON.parse(fs.readFileSync(modsFile, "utf8"));
      // Only return modifications from this session
      if (sessionId && mods.sessionId && mods.sessionId !== sessionId) {
        return { files: [], count: 0 };
      }
      return mods;
    }
  } catch (e) {
    // No modifications
  }
  return { files: [], count: 0 };
}

/**
 * Check if there's work worth documenting
 */
function hasWorkToDocument(sessionId, config) {
  const inGitRepo = isGitRepo();

  // Check for uncommitted changes (only if in git repo)
  if (inGitRepo) {
    try {
      const status = execSync("git status --porcelain", {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (status) {
        return true;
      }
    } catch (e) {
      // Git command failed - continue with other checks
    }
  }

  // Check for tracked modifications (session-specific)
  const mods = getSessionModifications(sessionId);
  if (mods.count >= config.minModificationsForSync) {
    return true;
  }

  // Check for recent commits (only if in git repo)
  if (inGitRepo) {
    try {
      const recentCommits = execSync('git log --oneline --since="1 hour ago"', {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      return recentCommits.length > 0;
    } catch (e) {
      // Git command failed
    }
  }

  return false;
}

/**
 * Mark session as synced
 */
function markSynced(sessionId) {
  const sessionFile = path.join(STATE_DIR, "current-session.json");
  try {
    let session = {};
    if (fs.existsSync(sessionFile)) {
      session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    }
    session.sessionId = sessionId;
    session.contextSynced = true;
    session.syncedAt = new Date().toISOString();
    session.syncedBy = "SessionEnd";

    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), "utf8");
  } catch (e) {
    logError(`Failed to mark synced: ${e.message}`);
  }
}

/**
 * Log error to error log file
 */
function logError(message) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const errorLog = path.join(LOG_DIR, "session-end-errors.log");
    fs.appendFileSync(errorLog, `${new Date().toISOString()}: ${message}\n`);
  } catch (e) {
    // Can't even log errors - give up silently
  }
}

/**
 * Get summary of work for the prompt
 */
function getWorkSummary(sessionId) {
  const parts = [];
  const inGitRepo = isGitRepo();

  if (inGitRepo) {
    // Git status
    try {
      const status = execSync("git status --short", {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (status) {
        parts.push("Uncommitted changes:\n" + status);
      }
    } catch (e) {
      // Skip
    }

    // Recent commits
    try {
      const commits = execSync("git log --oneline -5", {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (commits) {
        parts.push("Recent commits:\n" + commits);
      }
    } catch (e) {
      // Skip
    }
  } else {
    parts.push("(Not a git repository - tracking file modifications only)");
  }

  // Tracked modifications (session-specific)
  const mods = getSessionModifications(sessionId);
  if (mods.files && mods.files.length > 0) {
    parts.push("Files modified this session:\n" + mods.files.join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Spawn background claude process to finalize context
 */
function spawnBackgroundSync(sessionId, config) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const logFile = path.join(
    LOG_DIR,
    `session-end-${sessionId || Date.now()}.log`
  );
  const workSummary = getWorkSummary(sessionId);

  const prompt = `Session ended. Finalize project context:

${workSummary}

Your task:
1. Review what was accomplished this session based on the above
2. Update .claude/PROGRESS.md with:
   - Move completed items to "Recent Work" section
   - Update "Current State" with current status
   - Update "Next Steps" based on what you learned
3. If there are uncommitted changes that should be committed, commit them with a descriptive message
4. Do NOT start any new feature work - only document and commit existing work

Keep your changes minimal and focused on documentation.`;

  // Build command arguments
  const args = [
    "-p",
    "--max-turns",
    String(config.maxTurns),
    "--permission-mode",
    "bypassPermissions",
  ];

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  args.push(prompt);

  // Spawn detached process
  const logStream = fs.openSync(logFile, "a");

  const child = spawn("claude", args, {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    timeout: config.syncTimeout * 1000,
  });

  child.unref();

  // Log spawn info
  fs.appendFileSync(
    logFile,
    `\n--- Spawned at ${new Date().toISOString()} ---\n`
  );
  fs.appendFileSync(logFile, `Session ID: ${sessionId || "none"}\n`);
  fs.appendFileSync(logFile, `PID: ${child.pid}\n`);
  fs.appendFileSync(logFile, `Timeout: ${config.syncTimeout}s\n`);
  fs.appendFileSync(logFile, `Is Git Repo: ${isGitRepo()}\n`);
  fs.appendFileSync(logFile, `---\n\n`);

  fs.closeSync(logStream);
}

/**
 * Main
 */
function main() {
  const config = loadConfig();

  if (!config.enabled || !config.sessionEndSync) {
    process.exit(0);
  }

  // Prevent duplicate executions
  if (!acquireLock()) {
    process.exit(0);
  }

  const sessionId = hookInput.session_id || null;
  const sessionEndReason = hookInput.reason || "unknown"; // e.g. "exit"

  if (!sessionId) {
    logError("No session_id provided in hook input; aborting.");
    process.exit(0);
  }

  if (sessionEndReason !== "exit") {
    // Only run on normal exits
    process.exit(0);
  }

  // Skip if Stop hook already finalized this session
  if (wasContextSynced(sessionId)) {
    process.exit(0);
  }

  // Skip if no meaningful work to document
  if (!hasWorkToDocument(sessionId, config)) {
    process.exit(0);
  }

  // Spawn background sync
  try {
    spawnBackgroundSync(sessionId, config);
    markSynced(sessionId);
  } catch (e) {
    logError(`Spawn failed: ${e.message}`);
  }

  process.exit(0);
}

main();
