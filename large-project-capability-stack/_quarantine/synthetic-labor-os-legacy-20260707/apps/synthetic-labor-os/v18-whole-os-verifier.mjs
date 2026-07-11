#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  SLOS_V18_ALLOWED_PATCH_PATHS,
  SLOS_V18_ROLES,
  SLOS_V18_RUNTIME_PATCH_PATHS,
  SLOS_V18_TEST_PATCH_PATHS,
  allowedFilesForRole,
  candidateDesignFiles,
  candidateImplementationFiles,
  candidatePatchPath,
  candidateReviewFiles,
  candidateRoot,
  candidateScoreFiles,
  candidateTestFiles,
  candidateTestPlanPath,
  candidateTheme
} from './v18-whole-os-catalog.mjs';

const [verifier = 'role', workspaceArg = process.cwd(), fixture = ''] = process.argv.slice(2);
const workspace = path.resolve(workspaceArg);
const [candidateId, role = 'release_scorer'] = String(fixture || '').split('::');
if (!SLOS_V18_ROLES.includes(role)) fail(`Unknown role ${role}`);
const root = candidateRoot(candidateId);

const EXTERNAL_VALIDATION_CONTEXT_FILES = Object.freeze([
  {
    path: 'public/cortex_server/cortex_server/modules/reasoning_planner.py',
    fallback: 'def compile_plan_to_agent_work_handoff(*args, **kwargs):\n    return {"schemaVersion": "cortex.agent_work_handoff.v0"}\n'
  },
  {
    path: 'public/cortex_server/cortex_server/routers/orchestrator.py',
    fallback: 'from cortex_server.modules.reasoning_planner import compile_plan_to_agent_work_handoff\n# route: /plan/agent-work\n'
  },
  {
    path: 'public/cortex_server/cortex_server/runtime/agent_work_dsl.py',
    fallback: 'CORTEX_AGENT_WORK_HANDOFF_SCHEMA = "cortex.agent_work_handoff.v0"\n'
  }
]);

function abs(rel) { return path.join(workspace, rel); }
function exists(rel) { return fs.existsSync(abs(rel)); }
function read(rel) { return fs.readFileSync(abs(rel), 'utf8'); }
function tryJson(rel) { try { return JSON.parse(read(rel)); } catch { return null; } }
function out(payload, ok = payload.ok !== false) { console.log(JSON.stringify(payload, null, 2)); process.exit(ok ? 0 : 1); }
function fail(message, metadata = {}) { out({ ok: false, verifier, command: 'slos v18 verifier', durationMs: 0, stdout: '', stderr: message, metadata: { candidateId, role, ...metadata } }, false); }
function normalizeRelPath(value = '') {
  const normalized = String(value || '').replace(/^\/+/, '').replace(/^a\//, '').replace(/^b\//, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) return null;
  return normalized;
}
function extractDiffPaths(diff = '') {
  const paths = new Set();
  for (const line of String(diff || '').split(/\r?\n/)) {
    let match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) { paths.add(normalizeRelPath(match[1])); paths.add(normalizeRelPath(match[2])); continue; }
    match = line.match(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/);
    if (match && match[1] !== '/dev/null') paths.add(normalizeRelPath(match[1]));
  }
  return [...paths].filter(Boolean).sort();
}
function loadManifest() {
  const candidates = [
    path.join(workspace, 'v18_source_manifest.json'),
    path.join(workspace, 'source_manifest.json')
  ];
  for (const filePath of candidates) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  return {};
}
function sourceRepoPath() {
  const manifest = loadManifest();
  return path.resolve(manifest.sourceRepoPath || process.env.SLOS_V18_SOURCE_REPO || path.resolve(workspace, '..', '..'));
}
function validationCommands() {
  const manifest = loadManifest();
  const commands = Array.isArray(manifest.validationCommands) && manifest.validationCommands.length
    ? manifest.validationCommands
    : ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  return commands;
}
function roleExpectedFiles() {
  if (role === 'systems_architect') return candidateDesignFiles(candidateId);
  if (role === 'runtime_implementer') return candidateImplementationFiles(candidateId);
  if (role === 'test_engineer') return candidateTestFiles(candidateId);
  if (role === 'adversarial_reviewer') return candidateReviewFiles(candidateId);
  if (role === 'release_scorer') return candidateScoreFiles(candidateId);
  return allowedFilesForRole(candidateId, role);
}
function allExistingText(files) { return files.filter(exists).map((rel) => read(rel)).join('\n'); }

function expectedRoleOk() {
  const expected = roleExpectedFiles();
  const missing = expected.filter((rel) => !exists(rel));
  const expectedPresent = role === 'release_scorer'
    ? missing.length === 0
    : expected.some((rel) => exists(rel));
  const text = allExistingText(expected);
  const architecture = tryJson(`${root}/architecture.json`);
  const scorecard = tryJson(`${root}/role-artifacts/scorecard.json`);
  const checks = {
    expectedPresent,
    architectMeaningful: role !== 'systems_architect' || (architecture && /runtime|operator|test|risk|file/i.test(text)),
    implementationMeaningful: role !== 'runtime_implementer' || (exists(candidatePatchPath(candidateId)) && /^diff --git/m.test(read(candidatePatchPath(candidateId))) && /SLOS|Synthetic Labor OS|operator|provenance|remote|lifecycle/i.test(text)),
    testMeaningful: role !== 'test_engineer' || /node --test|assert|validation|apply|SLOS|Synthetic Labor OS/i.test(text),
    reviewerMeaningful: role !== 'adversarial_reviewer' || /risk|counterexample|verdict|scope|claim|runtime/i.test(text),
    scorerMeaningful: role !== 'release_scorer' || (scorecard && Number.isFinite(Number(scorecard.score)) && /strength|weakness|rationale|score|runtime/i.test(text))
  };
  return { ok: Object.values(checks).every(Boolean), expected, missing, checks };
}

function patchVerifier({ shapeOnly = false } = {}) {
  const patchRel = candidatePatchPath(candidateId);
  if (!exists(patchRel)) return { ok: false, reason: 'missing_candidate_patch' };
  const patchText = read(patchRel);
  const diffPaths = extractDiffPaths(patchText);
  const allowed = new Set(SLOS_V18_ALLOWED_PATCH_PATHS);
  const disallowedPaths = diffPaths.filter((rel) => !allowed.has(rel));
  const runtimePaths = diffPaths.filter((rel) => SLOS_V18_RUNTIME_PATCH_PATHS.includes(rel));
  const testPaths = diffPaths.filter((rel) => SLOS_V18_TEST_PATCH_PATHS.includes(rel));
  const docsOnly = diffPaths.length > 0 && diffPaths.every((rel) => rel.startsWith('docs/'));
  const hasRuntimePath = runtimePaths.length > 0;
  const hasTestPath = testPaths.length > 0;
  const hasBoundaryLanguage = /merge|publish|deploy|external|approval|truth|boundary|provenance/i.test(patchText);
  const basicOk = diffPaths.length > 0 && disallowedPaths.length === 0 && hasRuntimePath && hasTestPath && !docsOnly && hasBoundaryLanguage;
  let applyRun = { status: 0, stdout: '', stderr: '' };
  if (!shapeOnly && basicOk) {
    applyRun = spawnSync('git', ['apply', '--check', '--whitespace=nowarn', abs(patchRel)], { cwd: sourceRepoPath(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  }
  return {
    ok: basicOk && (shapeOnly || (applyRun.status ?? 1) === 0),
    shapeOnly,
    diffPaths,
    disallowedPaths,
    runtimePaths,
    testPaths,
    docsOnly,
    hasRuntimePath,
    hasTestPath,
    hasBoundaryLanguage,
    gitApplyCheck: shapeOnly ? { ok: null, skipped: true } : { ok: (applyRun.status ?? 1) === 0, exitCode: applyRun.status ?? 1, stdout: applyRun.stdout || '', stderr: applyRun.stderr || '' },
    lineCount: patchText.split(/\r?\n/).filter(Boolean).length,
    uniqueLineCount: new Set(patchText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).size
  };
}

function copyRepoForValidation(repoPath, tmp) {
  fs.mkdirSync(tmp, { recursive: true });
  const command = `cd ${shellQuote(repoPath)} && tar --exclude=.git --exclude=node_modules --exclude=artifacts --exclude='*.log' -cf - package.json apps packages tests docs | tar -xf - -C ${shellQuote(tmp)}`;
  return spawnSync('bash', ['-c', command], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, timeout: 120_000 });
}
function copyExternalValidationContext(repoPath, tempBasePath) {
  const sourceWorkspaceRoot = path.resolve(repoPath, '..');
  const copied = [];
  const synthesized = [];
  for (const entry of EXTERNAL_VALIDATION_CONTEXT_FILES) {
    const source = path.join(sourceWorkspaceRoot, entry.path);
    const target = path.join(tempBasePath, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(source) && fs.statSync(source).isFile()) {
      fs.copyFileSync(source, target);
      copied.push(entry.path);
    } else {
      fs.writeFileSync(target, entry.fallback);
      synthesized.push(entry.path);
    }
  }
  return {
    copied,
    synthesized,
    truthBoundary: 'Validation temp repos include stable external Cortex evidence context required by existing SLOS matrix tests. Candidate patches still apply only to allowed SLOS runtime/test paths.'
  };
}
function shellQuote(value = '') { return `'${String(value).replaceAll("'", `'\\''`)}'`; }
function runValidation() {
  const patch = patchVerifier({ shapeOnly: false });
  if (!patch.ok) return { ok: false, skipped: true, reason: 'patch_verifier_failed', patch };
  const repoPath = sourceRepoPath();
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), `slos-v18-${candidateId}-`));
  const tmp = path.join(tempBasePath, 'large-project-capability-stack');
  const copyRun = copyRepoForValidation(repoPath, tmp);
  if ((copyRun.status ?? 1) !== 0) return { ok: false, tempBasePath, tempRepoPath: tmp, copyRun: { exitCode: copyRun.status ?? 1, stdout: copyRun.stdout || '', stderr: copyRun.stderr || '' }, patch };
  const externalValidationContext = copyExternalValidationContext(repoPath, tempBasePath);
  const applyRun = spawnSync('git', ['apply', '--whitespace=nowarn', abs(candidatePatchPath(candidateId))], { cwd: tmp, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  if ((applyRun.status ?? 1) !== 0) return { ok: false, tempBasePath, tempRepoPath: tmp, externalValidationContext, applyRun: { exitCode: applyRun.status ?? 1, stdout: applyRun.stdout || '', stderr: applyRun.stderr || '' }, patch };
  const commands = validationCommands();
  const results = commands.map((command) => {
    const started = Date.now();
    const run = spawnSync(command, { cwd: tmp, shell: true, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, timeout: Number(process.env.SLOS_V18_VALIDATION_TIMEOUT_MS || 180_000) });
    return { command, ok: (run.status ?? 1) === 0, exitCode: run.status ?? 1, signal: run.signal || null, durationMs: Date.now() - started, stdoutTail: String(run.stdout || '').slice(-4000), stderrTail: String(run.stderr || '').slice(-4000) };
  });
  return { ok: results.every((entry) => entry.ok), tempBasePath, tempRepoPath: tmp, externalValidationContext, patch, commands, results };
}

function scoreVerifier() {
  const scorecard = tryJson(`${root}/role-artifacts/scorecard.json`) || {};
  const architecture = tryJson(`${root}/architecture.json`) || {};
  const patch = patchVerifier({ shapeOnly: false });
  const validation = runValidation();
  const text = [
    allExistingText(candidateDesignFiles(candidateId)),
    allExistingText(candidateTestFiles(candidateId)),
    allExistingText(candidateReviewFiles(candidateId)),
    allExistingText(candidateScoreFiles(candidateId))
  ].join('\n');
  const declaredScore = Number(scorecard.score ?? 0);
  const runtimeScore = Math.min(25, patch.runtimePaths.length * 8 + (patch.runtimePaths.includes('packages/synthetic-labor-os/index.mjs') ? 8 : 0));
  const testScore = Math.min(20, patch.testPaths.length * 10);
  const evidenceScore = validation.ok ? 25 : patch.gitApplyCheck?.ok ? 10 : 0;
  const designScore = /operator|remote|provenance|lifecycle|approval|dashboard|console|evidence/i.test(text) ? 15 : 5;
  const scopeScore = patch.disallowedPaths.length === 0 && !patch.docsOnly ? 15 : 0;
  const rubricScore = Math.min(100, Math.round(runtimeScore + testScore + evidenceScore + designScore + scopeScore));
  return {
    ok: patch.ok && validation.ok && Number.isFinite(declaredScore) && declaredScore >= 1 && Boolean(scorecard.rationale || scorecard.whyThisShouldWin),
    declaredScore,
    rubricScore,
    finalScore: Math.max(declaredScore, rubricScore),
    patch,
    validation,
    runtimePaths: patch.runtimePaths,
    testPaths: patch.testPaths,
    title: architecture.title || scorecard.title || `${candidateId} whole-SLOS variant`,
    theme: architecture.theme || candidateTheme(candidateId),
    strengths: scorecard.strengths || [],
    weaknesses: scorecard.weaknesses || [],
    rationale: scorecard.rationale || scorecard.whyThisShouldWin || null,
    scoringNote: 'SLOS v18 verifier requires real SLOS runtime/CLI changes, tests, patch applicability, and isolated validation. Docs-only candidates are invalid.'
  };
}

if (verifier === 'role') {
  const result = expectedRoleOk();
  out({
    ok: result.ok,
    verifier,
    command: 'slos v18 role artifact verifier',
    durationMs: 0,
    stdout: '',
    stderr: result.ok ? '' : JSON.stringify({ missing: result.missing, checks: result.checks }),
    metadata: { candidateId, role, theme: candidateTheme(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'patch-shape') {
  const result = patchVerifier({ shapeOnly: true });
  out({
    ok: result.ok,
    verifier,
    command: 'slos v18 patch shape verifier',
    durationMs: 0,
    stdout: JSON.stringify(result),
    stderr: result.ok ? '' : JSON.stringify(result),
    metadata: { candidateId, role, theme: candidateTheme(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'patch') {
  const result = patchVerifier({ shapeOnly: false });
  out({
    ok: result.ok,
    verifier,
    command: 'slos v18 patch verifier',
    durationMs: 0,
    stdout: JSON.stringify(result),
    stderr: result.ok ? '' : JSON.stringify(result),
    metadata: { candidateId, role, theme: candidateTheme(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'validation') {
  const result = runValidation();
  out({
    ok: result.ok,
    verifier,
    command: 'slos v18 isolated validation verifier',
    durationMs: 0,
    stdout: JSON.stringify(result),
    stderr: result.ok ? '' : JSON.stringify(result),
    metadata: { candidateId, role, theme: candidateTheme(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'score') {
  const result = scoreVerifier();
  out({
    ok: result.ok,
    verifier,
    command: 'slos v18 whole-os score verifier',
    durationMs: 0,
    stdout: JSON.stringify(result),
    stderr: result.ok ? '' : JSON.stringify(result),
    metadata: { candidateId, role, theme: candidateTheme(candidateId), ...result }
  }, result.ok);
}

fail(`Unknown verifier ${verifier}`);
