#!/usr/bin/env node
/**
 * validate-progress.js (v1.2)
 * 
 * Pre-validates PROGRESS.md and feature_list.json before the Stop hook prompt runs.
 * Generates a machine-readable summary that the LLM can use for accurate evaluation.
 * 
 * v1.2 Changes:
 * - Added feature_list.json validation
 * - Runs verification commands for current work item
 * - Reports verification results to Stop hook
 * - Updates work item status on success
 * 
 * v1.1 Changes:
 * - PROGRESS.md schema validation
 * - Generates repair templates for missing sections
 * 
 * Called by the Stop hook command before the prompt-based evaluation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = process.cwd();
const CLAUDE_DIR = path.join(projectRoot, '.claude');
const PROGRESS_FILE = path.join(CLAUDE_DIR, 'PROGRESS.md');
const FEATURE_LIST_FILE = path.join(CLAUDE_DIR, 'feature_list.json');
const STATE_DIR = path.join(CLAUDE_DIR, '.context-state');
const MODIFICATIONS_FILE = path.join(STATE_DIR, 'modifications.json');
const CONFIG_FILE = path.join(CLAUDE_DIR, 'context-sync.json');

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
 * Load plugin configuration
 */
function loadConfig() {
  const defaults = {
    enabled: true,
    verificationTimeout: 60,
    autoUpdateFeatureList: true,
    requireVerificationPass: true
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
 * Load feature_list.json
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
 * Save feature_list.json
 */
function saveFeatureList(featureList) {
  try {
    fs.writeFileSync(FEATURE_LIST_FILE, JSON.stringify(featureList, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get current in-progress work item
 */
function getCurrentWorkItem(featureList) {
  if (!featureList || !featureList.items) return null;
  return featureList.items.find(item => item.status === 'in-progress');
}

/**
 * Run a single verification command
 */
function runVerification(verification, timeout = 60) {
  const result = {
    command: verification.command,
    description: verification.description || verification.command,
    passed: false,
    output: '',
    error: null,
    duration: 0
  };
  
  const startTime = Date.now();
  
  try {
    const output = execSync(verification.command, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: timeout * 1000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    result.output = output.substring(0, 1000); // Limit output size
    result.duration = Date.now() - startTime;
    
    const expectedExit = verification.expectedExitCode || 0;
    const expectedOutput = verification.expectedOutput;
    
    // Check output pattern if specified
    if (expectedOutput) {
      const pattern = new RegExp(expectedOutput);
      if (!pattern.test(output)) {
        result.error = `Output did not match pattern: ${expectedOutput}`;
        return result;
      }
    }
    
    result.passed = true;
    return result;
  } catch (e) {
    result.duration = Date.now() - startTime;
    result.error = e.message || 'Command failed';
    result.output = (e.stdout || '') + (e.stderr || '');
    
    const expectedExit = verification.expectedExitCode || 0;
    if (e.status === expectedExit) {
      result.passed = true;
      result.error = null;
    }
    
    return result;
  }
}

/**
 * Run all verification commands for a work item
 */
function runWorkItemVerification(workItem, config) {
  if (!workItem || !workItem.verification || workItem.verification.length === 0) {
    return {
      itemId: workItem?.id,
      hasVerification: false,
      skipped: true
    };
  }
  
  const results = {
    itemId: workItem.id,
    itemDescription: workItem.description,
    hasVerification: true,
    skipped: false,
    tests: [],
    allPassed: false,
    requiredPassed: false
  };
  
  for (const verification of workItem.verification) {
    const testResult = runVerification(verification, config.verificationTimeout);
    testResult.optional = verification.optional || false;
    results.tests.push(testResult);
  }
  
  // Check if all tests passed
  results.allPassed = results.tests.every(t => t.passed);
  
  // Check if all required (non-optional) tests passed
  results.requiredPassed = results.tests
    .filter(t => !t.optional)
    .every(t => t.passed);
  
  return results;
}

/**
 * Update work item status based on verification results
 */
function updateWorkItemStatus(featureList, itemId, verificationResults, sessionId, config) {
  if (!config.autoUpdateFeatureList) return null;
  if (!featureList || !featureList.items) return null;
  
  const item = featureList.items.find(i => i.id === itemId);
  if (!item) return null;
  
  if (verificationResults.requiredPassed) {
    item.status = 'complete';
    item.completedAt = new Date().toISOString();
    item.sessionId = sessionId;
    
    // Update feature status if all items complete
    const allComplete = featureList.items.every(i => i.status === 'complete');
    if (allComplete) {
      featureList.status = 'complete';
    }
    
    // Increment completed sessions count
    featureList.completedSessions = (featureList.completedSessions || 0) + 1;
    featureList.updated = new Date().toISOString();
    
    saveFeatureList(featureList);
    return 'complete';
  }
  
  return null;
}

/**
 * Main
 */
function main() {
  const config = loadConfig();
  const sessionId = hookInput.session_id || null;
  
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
    repairTemplate: null,
    // New: feature list validation
    featureListExists: false,
    featureStatus: null,
    currentWorkItem: null,
    verificationResults: null,
    workItemUpdated: null
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

  // Feature list validation and verification
  const featureList = loadFeatureList();
  
  if (featureList) {
    validation.featureListExists = true;
    validation.featureStatus = featureList.status;
    
    // Check for in-progress work item
    const currentItem = getCurrentWorkItem(featureList);
    
    if (currentItem) {
      validation.currentWorkItem = {
        id: currentItem.id,
        description: currentItem.description,
        hasVerification: !!(currentItem.verification && currentItem.verification.length > 0)
      };
      
      // Run verification commands
      const verificationResults = runWorkItemVerification(currentItem, config);
      validation.verificationResults = verificationResults;
      
      if (verificationResults.hasVerification && !verificationResults.skipped) {
        if (verificationResults.requiredPassed) {
          // All required tests passed - can mark complete
          const updateResult = updateWorkItemStatus(
            featureList, 
            currentItem.id, 
            verificationResults, 
            sessionId, 
            config
          );
          validation.workItemUpdated = updateResult;
          
          if (updateResult === 'complete') {
            // Not an issue, but inform the LLM
            validation.issues.push(`Work item ${currentItem.id} verified and marked complete`);
          }
        } else {
          // Some required tests failed - block session end if configured
          const failedTests = verificationResults.tests.filter(t => !t.passed && !t.optional);
          const failedDescriptions = failedTests.map(t => t.description).join(', ');
          
          if (config.requireVerificationPass) {
            validation.issues.push(
              `Work item ${currentItem.id} verification FAILED: ${failedDescriptions}`
            );
          }
        }
      } else if (!verificationResults.hasVerification) {
        // No verification commands defined - warn but don't block
        validation.issues.push(
          `Work item ${currentItem.id} has no verification commands defined`
        );
      }
    } else if (featureList.status === 'in-progress') {
      // Feature in progress but no item marked in-progress
      const pendingItems = featureList.items.filter(i => i.status === 'pending');
      if (pendingItems.length > 0) {
        validation.issues.push(
          `Feature in progress but no work item is in-progress. Next: ${pendingItems[0].id}`
        );
      }
    }
  }

  // Output validation summary for the Stop hook
  const summary = {
    valid: validation.issues.length === 0 || 
           validation.issues.every(i => i.includes('verified and marked complete')),
    issues: validation.issues,
    details: {
      progressExists: validation.progressExists,
      sectionsPresent: validation.sectionsFound,
      sectionsMissing: validation.sectionsMissing,
      commitsSinceUpdate: validation.commitsSinceUpdate,
      uncommittedChanges: validation.uncommittedChanges,
      filesModifiedThisSession: validation.modifiedFiles.length,
      modifiedFiles: validation.modifiedFiles.slice(0, 10), // Limit for context size
      // Feature list details
      featureList: validation.featureListExists ? {
        status: validation.featureStatus,
        currentWorkItem: validation.currentWorkItem,
        verificationResults: validation.verificationResults ? {
          itemId: validation.verificationResults.itemId,
          allPassed: validation.verificationResults.allPassed,
          requiredPassed: validation.verificationResults.requiredPassed,
          tests: validation.verificationResults.tests?.map(t => ({
            description: t.description,
            passed: t.passed,
            optional: t.optional,
            error: t.error
          }))
        } : null,
        workItemUpdated: validation.workItemUpdated
      } : null
    },
    autoRepair: validation.canAutoRepair ? {
      available: true,
      template: validation.repairTemplate
    } : null
  };

  // Output as JSON for the hook to consume
  console.log(JSON.stringify(summary, null, 2));
  
  // Exit code indicates whether validation passed
  // Consider verification failures as blocking if configured
  const hasBlockingIssues = validation.issues.some(i => 
    !i.includes('verified and marked complete') &&
    (config.requireVerificationPass ? true : !i.includes('verification FAILED'))
  );
  
  process.exit(hasBlockingIssues ? 1 : 0);
}

main();
