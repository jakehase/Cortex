#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { productRootForVariant, scoreArchitecture, sourceFilesForVariant, testPathForVariant, variantById } from './webhook-architecture-catalog.mjs';

const [verifier = 'role', workspaceArg = process.cwd(), fixture = ''] = process.argv.slice(2);
const workspace = path.resolve(workspaceArg);
const [variantId, role = 'scorer_refiner'] = String(fixture || '').split('::');
const variant = variantById(variantId);
const root = productRootForVariant(variant);

function exists(rel) { return fs.existsSync(path.join(workspace, rel)); }
function read(rel) { return fs.readFileSync(path.join(workspace, rel), 'utf8'); }
function json(rel) { return JSON.parse(read(rel)); }
function lineCount(rel) { return read(rel).split('\n').length; }
function summarize(text = '', max = 3000) { const s = String(text || ''); return s.length <= max ? s : `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`; }
function out(payload, ok = payload.ok !== false) { console.log(JSON.stringify(payload, null, 2)); process.exit(ok ? 0 : 1); }

function roleExpectations() {
  if (role === 'architect') return [`${root}/README.md`, `${root}/architecture.json`, `${root}/role-artifacts/architect-brief.md`];
  if (role === 'implementer') return sourceFilesForVariant(variant).filter((rel) => rel.includes('/src/') && rel.endsWith('.mjs'));
  if (role === 'test_writer') return [testPathForVariant(variant)];
  if (role === 'adversarial_reviewer') return [`${root}/role-artifacts/adversarial-review.json`, `${root}/role-artifacts/adversarial-review.md`];
  if (role === 'scorer_refiner') return [`${root}/role-artifacts/scorecard.json`, `${root}/role-artifacts/refinement-notes.md`];
  return [];
}

if (verifier === 'role') {
  const expected = roleExpectations();
  const missing = expected.filter((rel) => !exists(rel));
  const text = expected.filter((rel) => exists(rel)).map(read).join('\n');
  const ok = missing.length === 0
    && (role !== 'architect' || /Design intent|layers/i.test(text))
    && (role !== 'implementer' || /export\s+function\s+createWebhookApp/.test(text))
    && (role !== 'test_writer' || /dedupes, processes, fails, and replays/.test(text))
    && (role !== 'adversarial_reviewer' || /architectureRisks|Adversarial review/.test(text))
    && (role !== 'scorer_refiner' || /preliminaryScore|Final score/.test(text));
  out({
    ok,
    verifier,
    command: 'role artifact verifier',
    durationMs: 0,
    stdout: '',
    stderr: ok ? '' : JSON.stringify({ role, missing }),
    metadata: { architectureId: variant.id, role, expected, missing, artifactLineCount: expected.filter(exists).reduce((sum, rel) => sum + lineCount(rel), 0) }
  }, ok);
}

if (verifier === 'tests') {
  const testFile = testPathForVariant(variant);
  const startedAt = Date.now();
  const run = spawnSync(process.execPath, ['--test', testFile], { cwd: workspace, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 });
  const ok = !run.error && run.status === 0;
  out({
    ok,
    verifier,
    command: `${process.execPath} --test ${testFile}`,
    durationMs: Date.now() - startedAt,
    stdout: summarize(run.stdout),
    stderr: summarize([run.stderr, run.error?.message].filter(Boolean).join('\n')),
    metadata: { architectureId: variant.id, role, behaviorCoverage: ['receive', 'idempotency', 'process_success', 'process_failure', 'replay', 'query', 'stats'], testFile }
  }, ok);
}

if (verifier === 'lint') {
  const architecturePath = `${root}/architecture.json`;
  const indexPath = `${root}/src/index.mjs`;
  const architecture = exists(architecturePath) ? json(architecturePath) : null;
  const files = [
    ...sourceFilesForVariant(variant),
    testPathForVariant(variant),
    ...['architect-brief.md', 'adversarial-review.json', 'adversarial-review.md', 'scorecard.json', 'refinement-notes.md'].map((name) => `${root}/role-artifacts/${name}`)
  ];
  const missing = files.filter((rel) => !exists(rel));
  const allText = files.filter(exists).map(read).join('\n');
  const lineTotal = files.filter(exists).reduce((sum, rel) => sum + lineCount(rel), 0);
  const duplicateRouteRegistration = (allText.match(/app\.(?:get|post|put|patch|delete)\s*\(/g) || []).length > 1;
  const markerOnly = /transferBenchmarkEvidence|semanticProductArchitecture|TODO_ONLY_MARKER/.test(allText);
  const hasCreateWebhookApp = exists(indexPath) && /export\s+function\s+createWebhookApp/.test(read(indexPath));
  const hasIdempotency = /idempotency/i.test(allText);
  const hasReplay = /replay/i.test(allText) && /outbox/i.test(allText);
  const layerCount = Array.isArray(architecture?.layers) ? architecture.layers.length : variant.layers.length;
  const fileCount = files.length - missing.length;
  const ok = missing.length === 0 && hasCreateWebhookApp && hasIdempotency && hasReplay && !duplicateRouteRegistration && !markerOnly;
  const score = scoreArchitecture({ variant, testOk: true, lintOk: ok, metrics: { fileCount, layerCount, lineCount: lineTotal } });
  out({
    ok,
    verifier,
    command: '100-agent final static architecture verifier',
    durationMs: 0,
    stdout: '',
    stderr: ok ? '' : JSON.stringify({ missing, hasCreateWebhookApp, hasIdempotency, hasReplay, duplicateRouteRegistration, markerOnly }),
    metadata: {
      architectureId: variant.id,
      role,
      architectureTitle: variant.title,
      pattern: variant.pattern,
      layers: architecture?.layers || variant.layers,
      layerCount,
      fileCount,
      productFileCount: sourceFilesForVariant(variant).filter((rel) => rel.endsWith('.mjs')).length,
      lineCount: lineTotal,
      duplicateRouteRegistration,
      markerOnly,
      hasCreateWebhookApp,
      hasIdempotency,
      hasReplay,
      architectureScore: score.total,
      scoreBreakdown: score.breakdown,
      scoreRubric: score.rubric
    }
  }, ok);
}

out({ ok: false, verifier, command: 'unknown verifier', durationMs: 0, stdout: '', stderr: `Unknown verifier ${verifier}`, metadata: { architectureId: variant.id, role } }, false);
