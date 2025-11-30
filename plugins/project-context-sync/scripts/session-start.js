#!/usr/bin/env node
/**
 * session-start.js (v1.2)
 * 
 * Runs at SessionStart to inject project context into Claude's awareness.
 * Reads PROGRESS.md, feature_list.json, and recent git history.
 * 
 * v1.2 Changes:
 * - Added feature_list.json awareness
 * - Shows current work item with verification criteria
 * - Runs smoke tests on previous session's completed work
 * - Feature progress tracking (X of Y items complete)
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
const FEATURE_LIST_FILE = path.join(CLAUDE_DIR, 'feature_list.json');
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
    quietStart: false,
    runSmokeTests: true,
    smokeTestTimeout: 30
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
 * Load and parse feature_list.json
 */
function loadFeatureList() {
  try {
    if (fs.existsSync(FEATURE_LIST_FILE)) {
      return JSON.parse(fs.readFileSync(FEATURE_LIST_FILE, 'utf8'));
    }
  } catch (e) {
    // Return null if invalid
  }
  return null;
}

/**
 * Get the next work item to work on
 */
function getNextWorkItem(featureList) {
  if (!featureList || !featureList.items) return null;
  
  // Find first pending item whose dependencies are all complete
  const completedIds = new Set(
    featureList.items
      .filter(item => item.status === 'complete')
      .map(item => item.id)
  );
  
  // First check for in-progress items
  const inProgress = featureList.items.find(item => item.status === 'in-progress');
  if (inProgress) return inProgress;
  
  // Find next pending item with satisfied dependencies
  for (const item of featureList.items) {
    if (item.status !== 'pending') continue;
    
    const deps = item.dependencies || [];
    const allDepsComplete = deps.every(depId => completedIds.has(depId));
    
    if (allDepsComplete) {
      return item;
    }
  }
  
  return null;
}

/**
 * Run verification command with timeout
 */
function runVerification(verification, timeout = 30) {
  try {
    const result = execSync(verification.command, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: timeout * 1000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const expectedExit = verification.expectedExitCode || 0;
    const expectedOutput = verification.expectedOutput;
    
    // Check output pattern if specified
    if (expectedOutput) {
      const pattern = new RegExp(expectedOutput);
      if (!pattern.test(result)) {
        return { passed: false, reason: `Output did not match pattern: ${expectedOutput}` };
      }
    }
    
    return { passed: true };
  } catch (e) {
    const expectedExit = verification.expectedExitCode || 0;
    if (e.status === expectedExit) {
      return { passed: true };
    }
    return { passed: false, reason: e.message || 'Command failed' };
  }
}

/**
 * Run smoke tests on last completed item
 */
function runSmokeTests(featureList, config) {
  if (!config.runSmokeTests) return null;
  if (!featureList || !featureList.items) return null;
  
  // Find most recently completed item
  const completedItems = featureList.items
    .filter(item => item.status === 'complete' && item.completedAt)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  
  if (completedItems.length === 0) return null;
  
  const lastCompleted = completedItems[0];
  if (!lastCompleted.verification || lastCompleted.verification.length === 0) {
    return null;
  }
  
  const results = {
    itemId: lastCompleted.id,
    itemDescription: lastCompleted.description,
    tests: []
  };
  
  for (const verification of lastCompleted.verification) {
    if (verification.optional) continue;
    
    const result = runVerification(verification, config.smokeTestTimeout);
    results.tests.push({
      command: verification.command,
      description: verification.description,
      passed: result.passed,
      reason: result.reason
    });
  }
  
  results.allPassed = results.tests.every(t => t.passed);
  return results;
}

/**
 * Calculate feature progress
 */
function getFeatureProgress(featureList) {
  if (!featureList || !featureList.items) return null;
  
  const total = featureList.items.length;
  const completed = featureList.items.filter(i => i.status === 'complete').length;
  const inProgress = featureList.items.filter(i => i.status === 'in-progress').length;
  const blocked = featureList.items.filter(i => i.status === 'blocked').length;
  const pending = featureList.items.filter(i => i.status === 'pending').length;
  
  return { total, completed, inProgress, blocked, pending };
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
  
  // Check for feature_list.json (multi-session feature tracking)
  const featureList = loadFeatureList();
  
  if (featureList && featureList.status !== 'complete') {
    const progress = getFeatureProgress(featureList);
    const nextItem = getNextWorkItem(featureList);
    
    contextParts.push('=== ACTIVE FEATURE ===');
    contextParts.push(`📦 **${featureList.feature}**`);
    contextParts.push(`Status: ${featureList.status}`);
    
    if (progress) {
      const progressBar = '█'.repeat(progress.completed) + '░'.repeat(progress.total - progress.completed);
      contextParts.push(`Progress: [${progressBar}] ${progress.completed}/${progress.total} items`);
      
      if (progress.blocked > 0) {
        contextParts.push(`⚠️ ${progress.blocked} item(s) blocked`);
      }
    }
    
    // Run smoke tests on last completed item
    if (config.runSmokeTests && progress && progress.completed > 0) {
      const smokeResults = runSmokeTests(featureList, config);
      if (smokeResults) {
        contextParts.push('');
        contextParts.push('--- Smoke Test (last completed item) ---');
        contextParts.push(`Item: ${smokeResults.itemId} - ${smokeResults.itemDescription}`);
        
        if (smokeResults.allPassed) {
          contextParts.push('✅ All verification tests still passing');
        } else {
          contextParts.push('❌ REGRESSION DETECTED:');
          for (const test of smokeResults.tests) {
            if (!test.passed) {
              contextParts.push(`  - ${test.description}: ${test.reason}`);
            }
          }
          contextParts.push('');
          contextParts.push('⚠️ Consider fixing regressions before starting new work.');
        }
      }
    }
    
    // Show next work item
    if (nextItem) {
      contextParts.push('');
      contextParts.push('--- Next Work Item ---');
      contextParts.push(`🎯 **${nextItem.id}**: ${nextItem.description}`);
      contextParts.push(`Effort: ${nextItem.estimatedEffort || 'not estimated'}`);
      
      if (nextItem.acceptanceCriteria && nextItem.acceptanceCriteria.length > 0) {
        contextParts.push('');
        contextParts.push('Acceptance Criteria:');
        for (const criterion of nextItem.acceptanceCriteria) {
          contextParts.push(`  • ${criterion}`);
        }
      }
      
      if (nextItem.verification && nextItem.verification.length > 0) {
        contextParts.push('');
        contextParts.push('Verification Commands:');
        for (const v of nextItem.verification) {
          contextParts.push(`  • ${v.description}: \`${v.command}\``);
        }
      }
      
      if (nextItem.notes) {
        contextParts.push('');
        contextParts.push(`Notes: ${nextItem.notes}`);
      }
      
      if (nextItem.dependencies && nextItem.dependencies.length > 0) {
        contextParts.push(`Dependencies: ${nextItem.dependencies.join(', ')} (all complete)`);
      }
    } else if (progress && progress.pending === 0 && progress.inProgress === 0) {
      contextParts.push('');
      contextParts.push('🎉 All work items complete! Consider marking feature as complete.');
    } else if (progress && progress.blocked > 0) {
      contextParts.push('');
      contextParts.push('⚠️ Remaining items are blocked. Review blocked items to unblock.');
    }
    
    contextParts.push('');
  }
  
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
  
  // Contextual guidance based on state
  if (featureList && featureList.status === 'in-progress') {
    const nextItem = getNextWorkItem(featureList);
    if (nextItem) {
      contextParts.push(`Focus on work item **${nextItem.id}**. Run verification commands when complete.`);
    }
  } else {
    contextParts.push('Review the above context, then choose ONE task to work on this session.');
  }

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
