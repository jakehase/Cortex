#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  aggregateContinuousThresholdMetrics,
  evaluateProductionQualityGate,
  readJson,
  writeJson
} from '../../packages/continuous-workload-controller/index.mjs';

function parseArgs(argv) {
  const args = {
    repoPath: process.cwd(),
    baselineRepoPath: process.env.PRODUCTION_QUALITY_BASELINE_REPO || null,
    baselineRef: process.env.PRODUCTION_QUALITY_BASELINE_REF || null,
    artifactRoot: process.env.PRODUCTION_QUALITY_ARTIFACT_ROOT || null,
    statePath: process.env.PRODUCTION_QUALITY_CONTROLLER_STATE || null,
    testCommand: process.env.PRODUCTION_QUALITY_TEST_COMMAND || 'npm test',
    skipTests: String(process.env.PRODUCTION_QUALITY_SKIP_TESTS || '0') === '1',
    maxTestFailureRegressionCount: Number(process.env.CONTINUOUS_CONTROLLER_MAX_TEST_FAILURE_REGRESSION || 0),
    maxRouteCollisionCount: Number(process.env.CONTINUOUS_CONTROLLER_MAX_ROUTE_COLLISIONS || 0),
    maxDuplicateNormalizedLineRatio: Number(process.env.CONTINUOUS_CONTROLLER_MAX_DUPLICATE_NORMALIZED_LINE_RATIO || 0.25),
    minArchitectureFitnessScore: Number(process.env.CONTINUOUS_CONTROLLER_MIN_ARCHITECTURE_FITNESS_SCORE || 0.9),
    maxArchitectureViolationCount: Number(process.env.CONTINUOUS_CONTROLLER_MAX_ARCHITECTURE_VIOLATIONS || 0)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--repo-path') { args.repoPath = path.resolve(next); index += 1; continue; }
    if (token === '--baseline-repo-path') { args.baselineRepoPath = path.resolve(next); index += 1; continue; }
    if (token === '--baseline-ref') { args.baselineRef = String(next || '').trim(); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--state-path') { args.statePath = path.resolve(next); index += 1; continue; }
    if (token === '--test-command') { args.testCommand = String(next || 'npm test'); index += 1; continue; }
    if (token === '--skip-tests') { args.skipTests = true; continue; }
    if (token === '--max-test-failure-regression') { args.maxTestFailureRegressionCount = Number(next); index += 1; continue; }
    if (token === '--max-route-collisions') { args.maxRouteCollisionCount = Number(next); index += 1; continue; }
    if (token === '--max-duplicate-normalized-line-ratio') { args.maxDuplicateNormalizedLineRatio = Number(next); index += 1; continue; }
    if (token === '--min-architecture-fitness-score') { args.minArchitectureFitnessScore = Number(next); index += 1; continue; }
    if (token === '--max-architecture-violations') { args.maxArchitectureViolationCount = Number(next); index += 1; continue; }
  }
  return args;
}

function listSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'artifacts') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll('\\', '/');
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/^(apps|packages)\//.test(rel)) continue;
      if (/(^|\/)tests?\//.test(rel)) continue;
      if (/\.(?:mjs|js|jsx|ts|tsx)$/.test(entry.name)) out.push({ full, rel });
    }
  };
  walk(root);
  return out;
}

function auditRouteCollisions(repoPath) {
  const routeMap = new Map();
  const routeRe = /router\.register\(\s*['"]([A-Z]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
  for (const file of listSourceFiles(repoPath)) {
    const text = fs.readFileSync(file.full, 'utf8');
    let match;
    while ((match = routeRe.exec(text))) {
      const key = `${match[1].toUpperCase()} ${match[2]}`;
      const entries = routeMap.get(key) || [];
      entries.push({ file: file.rel, offset: match.index });
      routeMap.set(key, entries);
    }
  }
  const duplicateRoutes = [...routeMap.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([route, entries]) => ({ route, count: entries.length, entries }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));
  return {
    routeCount: routeMap.size,
    duplicateRouteCount: duplicateRoutes.length,
    routeCollisionCount: duplicateRoutes.length,
    duplicateRoutes
  };
}

function runTestSummary(repoPath, command) {
  if (!repoPath || !fs.existsSync(repoPath)) return null;
  const result = spawnSync(command, { cwd: repoPath, shell: true, encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const numberAfter = (label) => {
    const match = output.match(new RegExp(`#\\s*${label}\\s+(\\d+)`, 'i'));
    return match ? Number(match[1]) : null;
  };
  return {
    command,
    exitCode: result.status,
    signal: result.signal || null,
    tests: numberAfter('tests'),
    pass: numberAfter('pass'),
    fail: numberAfter('fail'),
    cancelled: numberAfter('cancelled'),
    skipped: numberAfter('skipped'),
    todo: numberAfter('todo')
  };
}

function extractTestFailureHints(repoPath, output = '') {
  const failedTestLocations = [];
  const locationRe = /location:\s*'([^']+)'/g;
  let match;
  while ((match = locationRe.exec(String(output || '')))) {
    const absoluteOrRelative = match[1];
    const rel = path.isAbsolute(absoluteOrRelative)
      ? path.relative(repoPath, absoluteOrRelative).replaceAll('\\', '/')
      : absoluteOrRelative.replaceAll('\\', '/');
    if (/^tests\/.*\.(?:mjs|js|ts|tsx)(?::\d+:\d+)?$/.test(rel)) {
      const [file, line, column] = rel.split(':');
      failedTestLocations.push({ file, line: line ? Number(line) : null, column: column ? Number(column) : null });
    }
  }
  const failedTestFiles = [...new Set(failedTestLocations.map((entry) => entry.file))].sort();
  return {
    failedTestFiles,
    failedTestLocations: failedTestLocations.slice(0, 200),
    outputTail: String(output || '').slice(-12000)
  };
}

function runTestWithSummary(repoPath, command) {
  if (!repoPath || !fs.existsSync(repoPath)) return { summary: null, hints: { failedTestFiles: [], failedTestLocations: [], outputTail: '' } };
  const result = spawnSync(command, { cwd: repoPath, shell: true, encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const numberAfter = (label) => {
    const match = output.match(new RegExp(`#\\s*${label}\\s+(\\d+)`, 'i'));
    return match ? Number(match[1]) : null;
  };
  return {
    summary: {
      command,
      exitCode: result.status,
      signal: result.signal || null,
      tests: numberAfter('tests'),
      pass: numberAfter('pass'),
      fail: numberAfter('fail'),
      cancelled: numberAfter('cancelled'),
      skipped: numberAfter('skipped'),
      todo: numberAfter('todo')
    },
    hints: extractTestFailureHints(repoPath, output)
  };
}

function materializeBaselineWorktree({ repoPath, artifactRoot, baselineRef } = {}) {
  const ref = String(baselineRef || '').trim();
  if (!ref || !repoPath || !fs.existsSync(path.join(repoPath, '.git'))) return { repoPath: null, baselineRef: ref || null, materialized: false, reason: 'baseline_ref_or_git_repo_missing' };
  fs.mkdirSync(artifactRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(artifactRoot, 'baseline-worktree-'));
  const worktreePath = path.join(root, 'repo');
  const added = spawnSync('git', ['worktree', 'add', '--detach', worktreePath, ref], { cwd: repoPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (added.status !== 0) {
    fs.rmSync(root, { recursive: true, force: true });
    return {
      repoPath: null,
      baselineRef: ref,
      materialized: false,
      reason: 'git_worktree_add_failed',
      exitCode: added.status,
      stderr: String(added.stderr || '').slice(-4000)
    };
  }
  const sourceNodeModules = path.join(repoPath, 'node_modules');
  const targetNodeModules = path.join(worktreePath, 'node_modules');
  if (fs.existsSync(sourceNodeModules) && !fs.existsSync(targetNodeModules)) {
    try { fs.symlinkSync(sourceNodeModules, targetNodeModules, 'dir'); } catch {}
  }
  return { repoPath: worktreePath, baselineRef: ref, materialized: true, root, sourceRepoPath: repoPath };
}

function cleanupBaselineWorktree(materialized = {}) {
  if (!materialized?.materialized || !materialized.repoPath) return;
  try { spawnSync('git', ['worktree', 'remove', '--force', materialized.repoPath], { cwd: materialized.sourceRepoPath || process.cwd(), encoding: 'utf8' }); } catch {}
  try { fs.rmSync(materialized.root, { recursive: true, force: true }); } catch {}
}

function normalizeAddedLine(line = '') {
  const normalized = String(line || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (/^[{}()[\],.;:]+$/.test(normalized)) return '';
  if (new Set([
    'return {',
    '};',
    '});',
    ');',
    '}));',
    'try {',
    'else {',
    '} else {',
    '} catch (error) {'
  ]).has(normalized)) return '';
  return normalized;
}

function diffDerivedMetrics(repoPath) {
  const empty = {
    changedProductFiles: [],
    changedProductFileCount: 0,
    addedLineCount: 0,
    uniqueNormalizedAddedLineCount: 0,
    duplicateNormalizedLineRatio: 0,
    duplicateLineAudit: {
      ignoredStructuralLineCount: 0,
      topDuplicateNormalizedLines: [],
      topDuplicateNormalizedLinesByFile: {}
    }
  };
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) return empty;
  const numstat = spawnSync('git', ['diff', '--numstat', 'HEAD', '--', 'apps', 'packages', 'src', 'tests'], { cwd: repoPath, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const changedProductFiles = [];
  if (numstat.status === 0) {
    for (const line of String(numstat.stdout || '').split('\n')) {
      const parts = line.split('\t');
      const file = parts[2];
      if (!file) continue;
      const rel = file.trim();
      if (/^(apps|packages|src)\//.test(rel) && /\.(?:mjs|js|jsx|ts|tsx|html|css|json)$/.test(rel) && !/(^|\/)tests?\//.test(rel)) changedProductFiles.push(rel);
    }
  }
  const patch = spawnSync('git', ['diff', '--unified=0', 'HEAD', '--', 'apps', 'packages', 'src'], { cwd: repoPath, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const added = [];
  let ignoredStructuralLineCount = 0;
  let currentFile = null;
  const duplicateCountsByFile = new Map();
  if (patch.status === 0) {
    for (const line of String(patch.stdout || '').split('\n')) {
      if (line.startsWith('diff --git ')) {
        const parts = line.split(/\s+/);
        const candidate = parts[3] && parts[3].startsWith('b/') ? parts[3].slice(2) : null;
        currentFile = candidate || null;
      }
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const normalized = normalizeAddedLine(line.slice(1));
      if (normalized) {
        added.push(normalized);
        if (currentFile) {
          if (!duplicateCountsByFile.has(currentFile)) duplicateCountsByFile.set(currentFile, new Map());
          const fileCounts = duplicateCountsByFile.get(currentFile);
          fileCounts.set(normalized, Number(fileCounts.get(normalized) || 0) + 1);
        }
      } else if (String(line.slice(1)).trim()) {
        ignoredStructuralLineCount += 1;
      }
    }
  }
  const duplicateCounts = new Map();
  for (const line of added) duplicateCounts.set(line, Number(duplicateCounts.get(line) || 0) + 1);
  const unique = new Set(added);
  const topDuplicateNormalizedLines = [...duplicateCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([line, count]) => ({ line, count }));
  const topDuplicateNormalizedLinesByFile = {};
  for (const [file, counts] of duplicateCountsByFile.entries()) {
    const top = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([line, count]) => ({ line, count }));
    if (top.length) topDuplicateNormalizedLinesByFile[file] = top;
  }
  return {
    changedProductFiles: [...new Set(changedProductFiles)].sort(),
    changedProductFileCount: new Set(changedProductFiles).size,
    addedLineCount: added.length,
    uniqueNormalizedAddedLineCount: unique.size,
    duplicateNormalizedLineRatio: added.length > 0 ? (added.length - unique.size) / added.length : 0,
    duplicateLineAudit: {
      ignoredStructuralLineCount,
      topDuplicateNormalizedLines,
      topDuplicateNormalizedLinesByFile
    }
  };
}

const args = parseArgs(process.argv.slice(2));
const artifactRoot = args.artifactRoot || path.join(args.repoPath, 'artifacts', 'production-quality-gate');
const statePath = args.statePath || path.join(artifactRoot, 'continuous_controller_state.json');
const controllerState = readJson(statePath, null) || (args.artifactRoot ? readJson(path.join(args.artifactRoot, 'continuous_controller_state.json'), null) : null) || {};
const artifactBaselineRef = args.artifactRoot && fs.existsSync(path.join(args.artifactRoot, 'baseline_head.txt'))
  ? fs.readFileSync(path.join(args.artifactRoot, 'baseline_head.txt'), 'utf8').trim()
  : null;
const baselineRef = args.baselineRef || artifactBaselineRef;
const materializedBaseline = !args.skipTests && !args.baselineRepoPath && baselineRef
  ? materializeBaselineWorktree({ repoPath: args.repoPath, artifactRoot, baselineRef })
  : { repoPath: null, baselineRef: baselineRef || null, materialized: false };
const effectiveBaselineRepoPath = args.baselineRepoPath || materializedBaseline.repoPath || null;
const aggregateMetrics = aggregateContinuousThresholdMetrics(controllerState);
const diffMetrics = diffDerivedMetrics(args.repoPath);
const routeAudit = auditRouteCollisions(args.repoPath);
const finalTestRun = args.skipTests ? { summary: null, hints: { failedTestFiles: [], failedTestLocations: [], outputTail: '' } } : runTestWithSummary(args.repoPath, args.testCommand);
const baselineTestRun = args.skipTests || !effectiveBaselineRepoPath ? { summary: null, hints: { failedTestFiles: [], failedTestLocations: [], outputTail: '' } } : runTestWithSummary(effectiveBaselineRepoPath, args.testCommand);
const finalTestSummary = finalTestRun.summary;
const baselineTestSummary = baselineTestRun.summary;
const finalFail = finalTestSummary?.fail ?? null;
const baselineFail = baselineTestSummary?.fail ?? null;
const testFailureRegressionCount = finalFail == null ? null : baselineFail == null ? finalFail : Math.max(0, finalFail - baselineFail);
const architectureRelaxed = args.minArchitectureFitnessScore <= 0 && args.maxArchitectureViolationCount >= 999;
const baseMetrics = {
  ...aggregateMetrics,
  changedProductFiles: Array.isArray(aggregateMetrics.changedProductFiles) && aggregateMetrics.changedProductFiles.length ? aggregateMetrics.changedProductFiles : diffMetrics.changedProductFiles,
  changedProductFileCount: Number(aggregateMetrics.changedProductFileCount || 0) || diffMetrics.changedProductFileCount,
  addedLineCount: Number(aggregateMetrics.addedLineCount || 0) || diffMetrics.addedLineCount,
  uniqueNormalizedAddedLineCount: Number(aggregateMetrics.uniqueNormalizedAddedLineCount || 0) || diffMetrics.uniqueNormalizedAddedLineCount,
  duplicateNormalizedLineRatio: aggregateMetrics.duplicateNormalizedLineRatio ?? diffMetrics.duplicateNormalizedLineRatio,
  architectureFitnessScore: aggregateMetrics.architectureFitnessScore ?? (architectureRelaxed ? 0 : null),
  architectureViolationCount: aggregateMetrics.architectureViolationCount ?? (architectureRelaxed ? 0 : null),
  routeCollisionCount: routeAudit.routeCollisionCount,
  finalTestFailureCount: finalFail,
  baselineTestFailureCount: baselineFail,
  testFailureRegressionCount,
  integrationHardeningPass: testFailureRegressionCount === 0 && routeAudit.routeCollisionCount === 0 ? 1 : 0,
  architectureGatePass: architectureRelaxed ? 1 : aggregateMetrics.architectureEvidenceEvaluatedCount > 0 && aggregateMetrics.architectureViolationCount === 0 ? 1 : 0
};
const policy = {
  enabled: true,
  maxTestFailureRegressionCount: args.maxTestFailureRegressionCount,
  maxRouteCollisionCount: args.maxRouteCollisionCount,
  maxDuplicateNormalizedLineRatio: args.maxDuplicateNormalizedLineRatio,
  minArchitectureFitnessScore: args.minArchitectureFitnessScore,
  maxArchitectureViolationCount: args.maxArchitectureViolationCount,
  requireArchitectureGatePass: !architectureRelaxed,
  requireProductionQualityGatePass: false
};
const preliminary = evaluateProductionQualityGate({ metrics: baseMetrics, policy });
const metrics = {
  ...baseMetrics,
  productionQualityGatePass: preliminary.ok ? 1 : 0
};
const evaluation = evaluateProductionQualityGate({ metrics, policy: { ...policy, requireProductionQualityGatePass: true } });
const report = {
  generatedAt: new Date().toISOString(),
  ok: evaluation.ok,
  repoPath: args.repoPath,
  baselineRepoPath: effectiveBaselineRepoPath,
  requestedBaselineRepoPath: args.baselineRepoPath,
  baselineRef,
  baselineMaterialization: materializedBaseline ? {
    materialized: materializedBaseline.materialized === true,
    reason: materializedBaseline.reason || null,
    exitCode: materializedBaseline.exitCode ?? null,
    stderrTail: materializedBaseline.stderr || null
  } : null,
  statePath,
  routeAudit,
  finalTestSummary,
  baselineTestSummary,
  testFailureHints: finalTestRun.hints,
  baselineTestFailureHints: baselineTestRun.hints,
  duplicateLineAudit: diffMetrics.duplicateLineAudit || null,
  metrics,
  policy: evaluation.policy,
  failures: evaluation.failures
};
writeJson(path.join(artifactRoot, 'production_quality_gate.json'), report);
console.log(JSON.stringify(report, null, 2));
cleanupBaselineWorktree(materializedBaseline);
process.exit(evaluation.ok ? 0 : 1);
