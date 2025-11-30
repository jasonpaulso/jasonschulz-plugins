#!/usr/bin/env node
/**
 * validate-progress.js (v1.1)
 * 
 * Pre-validates PROGRESS.md before the Stop hook prompt runs.
 * Generates a machine-readable summary that the LLM can use for accurate evaluation.
 * Also validates/repairs PROGRESS.md schema.
 * 
 * Called by the Stop hook command before the prompt-based evaluation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = process.cwd();
const CLAUDE_DIR = path.join(projectRoot, '.claude');
const PROGRESS_FILE = path.join(CLAUDE_DIR, 'PROGRESS.md');
const STATE_DIR = path.join(CLAUDE_DIR, '.context-state');
const MODIFICATIONS_FILE = path.join(STATE_DIR, 'modifications.json');

// Required sections in PROGRESS.md
const REQUIRED_SECTIONS = [
  'Current State',
  'Recent Work',
  'Next Steps'
];

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
 * Check if we're in a git repository
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
 * Check which required sections exist in PROGRESS.md
 */
function checkSections(content) {
  const found = [];
  const missing = [];
  
  for (const section of REQUIRED_SECTIONS) {
    // Look for markdown headers with this section name
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
 * Get PROGRESS.md last modified time
 */
function getProgressModTime() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const stats = fs.statSync(PROGRESS_FILE);
      return stats.mtime;
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

/**
 * Count commits since PROGRESS.md was last modified
 */
function getCommitsSinceProgress() {
  if (!isGitRepo()) return null;
  
  const progressModTime = getProgressModTime();
  if (!progressModTime) return null;
  
  try {
    const isoTime = progressModTime.toISOString();
    const commits = execSync(`git log --oneline --since="${isoTime}"`, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    if (!commits) return 0;
    return commits.split('\n').length;
  } catch (e) {
    return null;
  }
}

/**
 * Get uncommitted changes count
 */
function getUncommittedCount() {
  if (!isGitRepo()) return null;
  
  try {
    const status = execSync('git status --porcelain', {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    if (!status) return 0;
    return status.split('\n').length;
  } catch (e) {
    return null;
  }
}

/**
 * Get session modifications
 */
function getSessionModifications() {
  try {
    if (fs.existsSync(MODIFICATIONS_FILE)) {
      const mods = JSON.parse(fs.readFileSync(MODIFICATIONS_FILE, 'utf8'));
      const sessionId = hookInput.session_id;
      
      // Only return if same session
      if (sessionId && mods.sessionId && mods.sessionId !== sessionId) {
        return { files: [], count: 0 };
      }
      return mods;
    }
  } catch (e) {
    // Ignore
  }
  return { files: [], count: 0 };
}

/**
 * Generate repair template for missing sections
 */
function generateRepairTemplate(missing) {
  const templates = {
    'Current State': `## Current State

**Status**: [Working | Partially Working | Broken]

[Describe current project state]
`,
    'Recent Work': `## Recent Work

### ${new Date().toISOString().split('T')[0]} - [Summary]
- [What was done]
`,
    'Next Steps': `## Next Steps

1. [Next priority task]
`
  };
  
  return missing.map(s => templates[s]).join('\n');
}

/**
 * Main
 */
function main() {
  const validation = {
    progressExists: false,
    sectionsFound: [],
    sectionsMissing: [],
    commitsSinceUpdate: null,
    uncommittedChanges: null,
    sessionModifications: 0,
    modifiedFiles: [],
    issues: [],
    canAutoRepair: false,
    repairTemplate: null
  };

  // Check if PROGRESS.md exists
  if (fs.existsSync(PROGRESS_FILE)) {
    validation.progressExists = true;
    
    const content = fs.readFileSync(PROGRESS_FILE, 'utf8');
    const { found, missing } = checkSections(content);
    
    validation.sectionsFound = found;
    validation.sectionsMissing = missing;
    
    if (missing.length > 0) {
      validation.issues.push(`Missing sections: ${missing.join(', ')}`);
      validation.canAutoRepair = true;
      validation.repairTemplate = generateRepairTemplate(missing);
    }
  } else {
    validation.issues.push('PROGRESS.md does not exist');
    validation.sectionsMissing = REQUIRED_SECTIONS;
    validation.canAutoRepair = true;
    validation.repairTemplate = `# Project Progress

${generateRepairTemplate(REQUIRED_SECTIONS)}`;
  }

  // Git-based checks
  const commitsSince = getCommitsSinceProgress();
  if (commitsSince !== null) {
    validation.commitsSinceUpdate = commitsSince;
    if (commitsSince > 0) {
      validation.issues.push(`${commitsSince} commit(s) since PROGRESS.md was last updated`);
    }
  }

  const uncommitted = getUncommittedCount();
  if (uncommitted !== null) {
    validation.uncommittedChanges = uncommitted;
    if (uncommitted > 0) {
      validation.issues.push(`${uncommitted} uncommitted change(s)`);
    }
  }

  // Session modifications
  const mods = getSessionModifications();
  validation.sessionModifications = mods.count || 0;
  validation.modifiedFiles = mods.files || [];
  
  if (mods.count > 0 && !validation.progressExists) {
    validation.issues.push(`${mods.count} file modifications this session but no PROGRESS.md`);
  }

  // Output validation summary for the Stop hook
  const summary = {
    valid: validation.issues.length === 0,
    issues: validation.issues,
    details: {
      progressExists: validation.progressExists,
      sectionsPresent: validation.sectionsFound,
      sectionsMissing: validation.sectionsMissing,
      commitsSinceUpdate: validation.commitsSinceUpdate,
      uncommittedChanges: validation.uncommittedChanges,
      filesModifiedThisSession: validation.modifiedFiles.length,
      modifiedFiles: validation.modifiedFiles.slice(0, 10) // Limit for context size
    },
    autoRepair: validation.canAutoRepair ? {
      available: true,
      template: validation.repairTemplate
    } : null
  };

  // Output as JSON for the hook to consume
  console.log(JSON.stringify(summary, null, 2));
  
  // Exit code indicates whether validation passed
  process.exit(validation.issues.length === 0 ? 0 : 1);
}

main();
