#!/usr/bin/env node
/**
 * session-start.js (v1.1)
 * 
 * Runs at SessionStart to inject project context into Claude's awareness.
 * Reads PROGRESS.md and recent git history, outputs as additionalContext.
 * 
 * v1.1 Changes:
 * - Added PROGRESS.md schema validation
 * - Reports missing sections with repair guidance
 * - Session ID tracking for isolation
 * - Improved context markers for model salience
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = process.cwd();
const CLAUDE_DIR = path.join(projectRoot, '.claude');
const PROGRESS_FILE = path.join(CLAUDE_DIR, 'PROGRESS.md');
const STATE_DIR = path.join(CLAUDE_DIR, '.context-state');
const CONFIG_FILE = path.join(CLAUDE_DIR, 'context-sync.json');

// Required sections
const REQUIRED_SECTIONS = ['Current State', 'Recent Work', 'Next Steps'];

// Read hook input from stdin
let hookInput = {};
try {
  const input = fs.readFileSync(0, 'utf8');
  if (input.trim()) {
    hookInput = JSON.parse(input);
  }
} catch (e) {
  // Continue without input
}

/**
 * Load plugin configuration
 */
function loadConfig() {
  const defaults = {
    enabled: true,
    worktreeIsolation: false,
    requireProgressFile: false,
    gitHistoryLines: 10,
    showFullProgress: true,
    quietStart: false
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...defaults, ...userConfig };
    }
  } catch (e) {
    // Use defaults
  }

  return defaults;
}

/**
 * Check if this is a git repository
 */
function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get recent git history
 */
function getGitHistory(lines = 10) {
  if (!isGitRepo()) return null;
  
  try {
    return execSync(`git log --oneline -${lines}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Get git status
 */
function getGitStatus() {
  if (!isGitRepo()) return null;
  
  try {
    return execSync('git status --short', {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Check which required sections exist in PROGRESS.md
 */
function checkSections(content) {
  const found = [];
  const missing = [];
  
  for (const section of REQUIRED_SECTIONS) {
    const patterns = [
      new RegExp(`^##\\s+${section}`, 'mi'),
      new RegExp(`^###\\s+${section}`, 'mi'),
      new RegExp(`^#\\s+${section}`, 'mi'),
      new RegExp(`\\*\\*${section}\\*\\*`, 'i')
    ];
    
    const exists = patterns.some(p => p.test(content));
    if (exists) {
      found.push(section);
    } else {
      missing.push(section);
    }
  }
  
  return { found, missing };
}

/**
 * Initialize state directory and record session
 */
function initStateDir(sessionId) {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  
  // Clear stale modification tracking
  const modFile = path.join(STATE_DIR, 'modifications.json');
  if (fs.existsSync(modFile)) {
    try {
      const mods = JSON.parse(fs.readFileSync(modFile, 'utf8'));
      // Only clear if from a different session
      if (sessionId && mods.sessionId && mods.sessionId !== sessionId) {
        fs.unlinkSync(modFile);
      }
    } catch (e) {
      fs.unlinkSync(modFile);
    }
  }
  
  // Record session start
  if (sessionId) {
    const sessionFile = path.join(STATE_DIR, 'current-session.json');
    fs.writeFileSync(sessionFile, JSON.stringify({
      sessionId,
      startTime: new Date().toISOString(),
      cwd: projectRoot,
      contextSynced: false
    }, null, 2), 'utf8');
  }
}

/**
 * Main
 */
function main() {
  const config = loadConfig();
  
  if (!config.enabled) {
    process.exit(0);
  }

  const sessionId = hookInput.session_id || null;
  
  // Initialize state
  initStateDir(sessionId);

  // Build context output with clear markers
  const contextParts = [];
  
  contextParts.push('### PROJECT CONTEXT START ###');
  
  // Check for PROGRESS.md
  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = fs.readFileSync(PROGRESS_FILE, 'utf8');
    const { found, missing } = checkSections(progress);
    
    if (missing.length > 0) {
      contextParts.push(`⚠️ PROGRESS.md is missing sections: ${missing.join(', ')}`);
      contextParts.push('Consider adding these sections before ending the session.');
      contextParts.push('');
    }
    
    if (config.showFullProgress) {
      contextParts.push('=== PROGRESS.md ===');
      contextParts.push(progress);
    } else {
      const lines = progress.split('\n');
      const preview = lines.slice(0, 30).join('\n');
      contextParts.push('=== PROGRESS.md (preview) ===');
      contextParts.push(preview);
      if (lines.length > 30) {
        contextParts.push(`\n... (${lines.length - 30} more lines)`);
      }
    }
  } else {
    contextParts.push('📋 No .claude/PROGRESS.md found.');
    contextParts.push('');
    contextParts.push('This project would benefit from context tracking. Create PROGRESS.md with:');
    contextParts.push('- **Current State**: What\'s working, what\'s broken');
    contextParts.push('- **Recent Work**: What was done recently and why');
    contextParts.push('- **Next Steps**: Prioritized list of what to work on');
    contextParts.push('');
    contextParts.push('Run /sync-context to initialize, or create manually.');
  }

  // Add git context
  if (isGitRepo()) {
    const history = getGitHistory(config.gitHistoryLines);
    if (history) {
      contextParts.push('\n=== RECENT GIT HISTORY ===');
      contextParts.push(history);
    }

    const status = getGitStatus();
    if (status) {
      contextParts.push('\n=== UNCOMMITTED CHANGES ===');
      contextParts.push(status);
    } else {
      contextParts.push('\n=== GIT STATUS: Clean working tree ===');
    }
  } else {
    contextParts.push('\n(Not a git repository)');
  }

  contextParts.push('\n### PROJECT CONTEXT END ###');
  contextParts.push('');
  contextParts.push('Review the above context, then choose ONE task to work on this session.');

  // Output context
  if (!config.quietStart) {
    const context = contextParts.join('\n');
    
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context
      }
    }));
  }

  process.exit(0);
}

main();
