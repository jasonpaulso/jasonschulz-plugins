#!/usr/bin/env node
/**
 * track-modification.js (v1.1)
 * 
 * Runs PostToolUse for Write|Edit|NotebookEdit to track file modifications.
 * Used to detect when context may be stale.
 * 
 * v1.1 Changes:
 * - Added session_id tracking for session isolation
 * - Modifications from different sessions are tracked separately
 */

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const STATE_DIR = path.join(projectRoot, '.claude', '.context-state');
const MODIFICATIONS_FILE = path.join(STATE_DIR, 'modifications.json');

// Read hook input from stdin
let hookInput = {};
try {
  const input = fs.readFileSync(0, 'utf8');
  if (input.trim()) {
    hookInput = JSON.parse(input);
  }
} catch (e) {
  process.exit(0);
}

/**
 * Extract file path from tool input
 */
function getFilePath(toolInput) {
  if (!toolInput) return null;
  return toolInput.file_path || toolInput.filePath || toolInput.path || null;
}

/**
 * Load current modifications
 */
function loadModifications() {
  try {
    if (fs.existsSync(MODIFICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(MODIFICATIONS_FILE, 'utf8'));
    }
  } catch (e) {
    // Start fresh
  }
  return {
    sessionId: null,
    files: [],
    count: 0,
    lastModified: null,
    contextSyncedAt: null
  };
}

/**
 * Save modifications
 */
function saveModifications(data) {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  fs.writeFileSync(MODIFICATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Main
 */
function main() {
  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const sessionId = hookInput.session_id || null;
  const filePath = getFilePath(toolInput);

  if (!filePath) {
    process.exit(0);
  }

  // Get relative path for cleaner tracking
  const relativePath = path.relative(projectRoot, filePath);
  
  // Skip tracking for context-related files
  if (relativePath.includes('.claude/') && 
      (relativePath.includes('PROGRESS.md') || 
       relativePath.includes('.context-state'))) {
    process.exit(0);
  }

  // Load and update modifications
  let mods = loadModifications();
  
  // If this is a different session, reset the tracking
  if (sessionId && mods.sessionId && mods.sessionId !== sessionId) {
    mods = {
      sessionId: sessionId,
      files: [],
      count: 0,
      lastModified: null,
      contextSyncedAt: null
    };
  }
  
  // Set session ID if not set
  if (sessionId && !mods.sessionId) {
    mods.sessionId = sessionId;
  }
  
  // Track the modification
  if (!mods.files.includes(relativePath)) {
    mods.files.push(relativePath);
  }
  mods.count++;
  mods.lastModified = new Date().toISOString();

  saveModifications(mods);
  process.exit(0);
}

main();
