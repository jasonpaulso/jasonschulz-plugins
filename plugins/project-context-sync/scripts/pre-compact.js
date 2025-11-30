#!/usr/bin/env node
/**
 * pre-compact.js
 * 
 * Runs before context compaction to remind Claude to update PROGRESS.md.
 * This ensures context is captured before memory is compressed.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const STATE_DIR = path.join(projectRoot, '.claude', '.context-state');
const MODIFICATIONS_FILE = path.join(STATE_DIR, 'modifications.json');
const PROGRESS_FILE = path.join(projectRoot, '.claude', 'PROGRESS.md');

/**
 * Load modifications since last sync
 */
function loadModifications() {
  try {
    if (fs.existsSync(MODIFICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(MODIFICATIONS_FILE, 'utf8'));
    }
  } catch (e) {
    // No modifications tracked
  }
  return { files: [], count: 0 };
}

/**
 * Check if PROGRESS.md was recently updated
 */
function progressRecentlyUpdated() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) {
      return false;
    }
    const stats = fs.statSync(PROGRESS_FILE);
    const mods = loadModifications();
    
    // If PROGRESS.md was modified after the last tracked modification, it's current
    if (mods.lastModified) {
      return stats.mtime > new Date(mods.lastModified);
    }
    
    // If modified within the last 5 minutes, consider it current
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return stats.mtime.getTime() > fiveMinutesAgo;
  } catch (e) {
    return false;
  }
}

/**
 * Main
 */
function main() {
  const mods = loadModifications();
  
  // If significant work has been done but PROGRESS.md hasn't been updated
  if (mods.count > 0 && !progressRecentlyUpdated()) {
    const fileList = mods.files.slice(0, 5).join(', ');
    const moreFiles = mods.files.length > 5 ? ` and ${mods.files.length - 5} more` : '';
    
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: `⚠️ CONTEXT COMPACTION IMMINENT\n\nYou have modified ${mods.files.length} file(s) (${fileList}${moreFiles}) but .claude/PROGRESS.md has not been updated.\n\nBefore compaction, consider updating PROGRESS.md with:\n- Summary of changes made\n- Current state of work\n- Next steps\n\nThis ensures context survives compaction.`
      }
    }));
  }

  process.exit(0);
}

main();
