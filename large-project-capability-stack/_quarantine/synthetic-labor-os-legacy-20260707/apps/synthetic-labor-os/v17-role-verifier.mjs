#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  SLOS_V17_ROLES,
  allowedFilesForRole,
  candidateDesignFiles,
  candidatePatchPath,
  candidateReviewFiles,
  candidateRoot,
  candidateScoreFiles,
  candidateSeed,
  candidateTarget,
  candidateTestFiles
} from './v17-role-catalog.mjs';

const [verifier = 'role', workspaceArg = process.cwd(), fixture = ''] = process.argv.slice(2);
const workspace = path.resolve(workspaceArg);
const [candidateId, role = 'scorer_refiner'] = String(fixture || '').split('::');
if (!SLOS_V17_ROLES.includes(role)) fail(`Unknown role ${role}`);
const root = candidateRoot(candidateId);

function abs(rel) { return path.join(workspace, rel); }
function exists(rel) { return fs.existsSync(abs(rel)); }
function read(rel) { return fs.readFileSync(abs(rel), 'utf8'); }
function tryJson(rel) { try { return JSON.parse(read(rel)); } catch { return null; } }
function out(payload, ok = payload.ok !== false) { console.log(JSON.stringify(payload, null, 2)); process.exit(ok ? 0 : 1); }
function fail(message, metadata = {}) { out({ ok: false, verifier, command: 'slos v17 verifier', durationMs: 0, stdout: '', stderr: message, metadata: { candidateId, role, ...metadata } }, false); }

function roleExpectedFiles() {
  if (role === 'strategist') return candidateDesignFiles(candidateId);
  if (role === 'patch_author') return [candidatePatchPath(candidateId), `${root}/proposal.md`, `${root}/role-artifacts/patch-author-notes.md`];
  if (role === 'test_writer') return candidateTestFiles(candidateId);
  if (role === 'adversarial_reviewer') return candidateReviewFiles(candidateId);
  if (role === 'scorer_refiner') return candidateScoreFiles(candidateId);
  return allowedFilesForRole(candidateId, role);
}

function allExistingText(files) {
  return files.filter(exists).map((rel) => read(rel)).join('\n');
}

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

function expectedRoleOk() {
  const expected = roleExpectedFiles();
  const missing = expected.filter((rel) => !exists(rel));
  const text = allExistingText(expected);
  const architecture = tryJson(`${root}/architecture.json`);
  const scorecard = tryJson(`${root}/role-artifacts/scorecard.json`);
  const checks = {
    expectedPresent: missing.length === 0,
    strategistMeaningful: role !== 'strategist' || (architecture && /rationale|tradeoffs|review/i.test(text)),
    patchAuthorMeaningful: role !== 'patch_author' || (exists(candidatePatchPath(candidateId)) && /^diff --git/m.test(read(candidatePatchPath(candidateId))) && /SLOS|Synthetic Labor OS|operator/i.test(text)),
    testWriterMeaningful: role !== 'test_writer' || /git apply|target|truth|validation|SLOS/i.test(text),
    reviewerMeaningful: role !== 'adversarial_reviewer' || /risk|counterexample|verdict|target|claim/i.test(text),
    scorerMeaningful: role !== 'scorer_refiner' || (scorecard && Number.isFinite(Number(scorecard.score)) && /strength|weakness|rationale|score/i.test(text))
  };
  return { ok: Object.values(checks).every(Boolean), expected, missing, checks };
}

function patchVerifier() {
  const patchRel = candidatePatchPath(candidateId);
  if (!exists(patchRel)) return { ok: false, reason: 'missing_candidate_patch' };
  const patchText = read(patchRel);
  const architecture = tryJson(`${root}/architecture.json`) || {};
  const expectedTarget = architecture.candidateTarget || candidateTarget(candidateId, 'RUN');
  const diffPaths = extractDiffPaths(patchText);
  const targetOk = diffPaths.length === 1 && diffPaths[0] === expectedTarget;
  const hasBoundary = /does not merge|not merge|publish|deploy|external/i.test(patchText);
  const hasSLOS = /Synthetic Labor OS|SLOS/i.test(patchText);
  const applyRun = spawnSync('git', ['apply', '--check', '--whitespace=nowarn', abs(patchRel)], { cwd: workspace, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  return {
    ok: targetOk && hasBoundary && hasSLOS && (applyRun.status ?? 1) === 0,
    expectedTarget,
    diffPaths,
    targetOk,
    hasBoundary,
    hasSLOS,
    gitApplyCheck: { ok: (applyRun.status ?? 1) === 0, exitCode: applyRun.status ?? 1, stdout: applyRun.stdout || '', stderr: applyRun.stderr || '' },
    lineCount: patchText.split(/\r?\n/).filter(Boolean).length,
    uniqueLineCount: new Set(patchText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).size
  };
}

function scoreVerifier() {
  const scorecard = tryJson(`${root}/role-artifacts/scorecard.json`) || {};
  const architecture = tryJson(`${root}/architecture.json`) || {};
  const patch = patchVerifier();
  const text = [
    allExistingText(candidateDesignFiles(candidateId)),
    allExistingText(candidateTestFiles(candidateId)),
    allExistingText(candidateReviewFiles(candidateId)),
    allExistingText(candidateScoreFiles(candidateId))
  ].join('\n');
  const declaredScore = Number(scorecard.score ?? 0);
  const layers = Array.isArray(architecture.layers) ? architecture.layers : [];
  const strengths = Array.isArray(scorecard.strengths) ? scorecard.strengths : [];
  const weaknesses = Array.isArray(scorecard.weaknesses) ? scorecard.weaknesses : [];
  const rubricScore = Math.min(100, Math.round(
    35
    + Math.min(20, patch.lineCount || 0)
    + Math.min(15, (patch.uniqueLineCount || 0) / 2)
    + Math.min(10, layers.length * 2)
    + Math.min(10, strengths.length * 2)
    + Math.min(5, weaknesses.length)
    + (/rollback|provenance|operator|role-agent|parallel/i.test(text) ? 5 : 0)
  ));
  return {
    ok: patch.ok && Number.isFinite(declaredScore) && declaredScore >= 1 && Boolean(scorecard.rationale || scorecard.whyThisShouldWin) && Boolean(scorecard.candidateTarget || architecture.candidateTarget),
    declaredScore,
    rubricScore,
    finalScore: Math.max(declaredScore, rubricScore),
    patch,
    layers,
    strengths,
    weaknesses,
    candidateTarget: scorecard.candidateTarget || architecture.candidateTarget || null,
    scoringNote: 'SLOS v17 verifier combines candidate scorecard with patch applicability, target isolation, role artifacts, and SLOS boundary language.'
  };
}

if (verifier === 'role') {
  const result = expectedRoleOk();
  out({
    ok: result.ok,
    verifier,
    command: 'slos v17 role artifact verifier',
    durationMs: 0,
    stdout: '',
    stderr: result.ok ? '' : JSON.stringify({ missing: result.missing, checks: result.checks }),
    metadata: { candidateId, role, explorationSeed: candidateSeed(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'patch') {
  const result = patchVerifier();
  out({
    ok: result.ok,
    verifier,
    command: 'slos v17 patch verifier',
    durationMs: 0,
    stdout: JSON.stringify(result),
    stderr: result.ok ? '' : JSON.stringify(result),
    metadata: { candidateId, role, explorationSeed: candidateSeed(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'score') {
  const result = scoreVerifier();
  out({
    ok: result.ok,
    verifier,
    command: 'slos v17 score verifier',
    durationMs: 0,
    stdout: JSON.stringify(result),
    stderr: result.ok ? '' : JSON.stringify(result),
    metadata: { candidateId, role, explorationSeed: candidateSeed(candidateId), ...result }
  }, result.ok);
}

fail(`Unknown verifier ${verifier}`);
