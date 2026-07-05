#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { allowedFilesForVariant, productRootForVariant, scoreArchitecture, sourceFilesForVariant, testPathForVariant, variantById } from './webhook-architecture-catalog.mjs';

const [verifier = 'tests', workspaceArg = process.cwd(), variantIdArg = ''] = process.argv.slice(2);
const workspace = path.resolve(workspaceArg);
const variant = variantById(variantIdArg);

function read(rel) {
  return fs.readFileSync(path.join(workspace, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(workspace, rel));
}

function lineCount(rel) {
  return read(rel).split('\n').length;
}

function summarizeCommandOutput(text = '', max = 3000) {
  const value = String(text || '');
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function write(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

if (verifier === 'tests') {
  const testFile = testPathForVariant(variant);
  const startedAt = Date.now();
  const run = spawnSync(process.execPath, ['--test', testFile], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000
  });
  write({
    ok: !run.error && run.status === 0,
    verifier,
    command: `${process.execPath} --test ${testFile}`,
    durationMs: Date.now() - startedAt,
    stdout: summarizeCommandOutput(run.stdout),
    stderr: summarizeCommandOutput([run.stderr, run.error?.message].filter(Boolean).join('\n')),
    metadata: {
      architectureId: variant.id,
      behaviorCoverage: ['receive', 'idempotency', 'process_success', 'process_failure', 'replay', 'query', 'stats'],
      testFile
    }
  });
  process.exit(!run.error && run.status === 0 ? 0 : 1);
}

if (verifier === 'lint') {
  const files = allowedFilesForVariant(variant);
  const productFiles = sourceFilesForVariant(variant).filter((rel) => rel.endsWith('.mjs'));
  const missing = files.filter((rel) => !exists(rel));
  const architecturePath = `${productRootForVariant(variant)}/architecture.json`;
  const architecture = exists(architecturePath) ? JSON.parse(read(architecturePath)) : null;
  const allText = files.filter(exists).map(read).join('\n');
  const lineTotal = files.filter(exists).reduce((sum, rel) => sum + lineCount(rel), 0);
  const duplicateRouteRegistration = (allText.match(/app\.(?:get|post|put|patch|delete)\s*\(/g) || []).length > 1;
  const markerOnly = /transferBenchmarkEvidence|semanticProductArchitecture|TODO_ONLY_MARKER/.test(allText);
  const hasCreateWebhookApp = /export\s+function\s+createWebhookApp/.test(read(`${productRootForVariant(variant)}/src/index.mjs`));
  const hasIdempotency = /idempotency/i.test(allText);
  const hasReplay = /replay/i.test(allText) && /outbox/i.test(allText);
  const layerCount = Array.isArray(architecture?.layers) ? architecture.layers.length : variant.layers.length;
  const fileCount = files.length;
  const testOk = missing.length === 0 && hasCreateWebhookApp && hasIdempotency && hasReplay && !duplicateRouteRegistration && !markerOnly;
  const score = scoreArchitecture({ variant, testOk: true, lintOk: testOk, metrics: { fileCount, layerCount, lineCount: lineTotal } });
  write({
    ok: testOk,
    verifier,
    command: 'static architecture verifier',
    durationMs: 0,
    stdout: '',
    stderr: testOk ? '' : JSON.stringify({ missing, hasCreateWebhookApp, hasIdempotency, hasReplay, duplicateRouteRegistration, markerOnly }),
    metadata: {
      architectureId: variant.id,
      architectureTitle: variant.title,
      pattern: variant.pattern,
      layers: architecture?.layers || variant.layers,
      layerCount,
      fileCount,
      productFileCount: productFiles.length,
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
  });
  process.exit(testOk ? 0 : 1);
}

write({ ok: false, verifier, command: 'unknown verifier', durationMs: 0, stdout: '', stderr: `Unknown verifier ${verifier}` });
process.exit(1);
