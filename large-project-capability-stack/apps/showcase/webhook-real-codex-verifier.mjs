#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REAL_CODEX_ROLES,
  allCandidateFiles,
  allowedFilesForRole,
  candidateDesignFiles,
  candidateRoot,
  candidateSourceFiles,
  candidateTestPath,
  candidateReviewFiles,
  candidateScoreFiles,
  candidateSeed
} from './webhook-real-codex-catalog.mjs';

const [verifier = 'role', workspaceArg = process.cwd(), fixture = ''] = process.argv.slice(2);
const workspace = path.resolve(workspaceArg);
const [candidateId, role = 'scorer_refiner'] = String(fixture || '').split('::');
if (!REAL_CODEX_ROLES.includes(role)) fail(`Unknown role ${role}`);
const root = candidateRoot(candidateId);

function abs(rel) { return path.join(workspace, rel); }
function exists(rel) { return fs.existsSync(abs(rel)); }
function read(rel) { return fs.readFileSync(abs(rel), 'utf8'); }
function countLines(rel) { return read(rel).split('\n').length; }
function tryJson(rel) { try { return JSON.parse(read(rel)); } catch { return null; } }
function summarize(text = '', max = 3000) { const s = String(text || ''); return s.length <= max ? s : `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`; }
function out(payload, ok = payload.ok !== false) { console.log(JSON.stringify(payload, null, 2)); process.exit(ok ? 0 : 1); }
function fail(message, metadata = {}) { out({ ok: false, verifier, command: 'real codex verifier', durationMs: 0, stdout: '', stderr: message, metadata: { candidateId, role, ...metadata } }, false); }

function roleExpectedFiles() {
  if (role === 'architect') return candidateDesignFiles(candidateId);
  if (role === 'implementer') return [path.join(root, 'src/index.mjs').replaceAll(path.sep, '/')];
  if (role === 'test_writer') return [candidateTestPath(candidateId)];
  if (role === 'adversarial_reviewer') return candidateReviewFiles(candidateId);
  if (role === 'scorer_refiner') return candidateScoreFiles(candidateId);
  return allowedFilesForRole(candidateId, role);
}

function allExistingText(files) {
  return files.filter(exists).map((rel) => read(rel)).join('\n');
}

function expectedRoleOk() {
  const expected = roleExpectedFiles();
  const missing = expected.filter((rel) => !exists(rel));
  const text = allExistingText(expected);
  const indexText = exists(`${root}/src/index.mjs`) ? read(`${root}/src/index.mjs`) : '';
  const sourceText = allExistingText(candidateSourceFiles(candidateId));
  const checks = {
    expectedPresent: missing.length === 0,
    architectMeaningful: role !== 'architect' || (/layers|rationale|tradeoffs|architecture/i.test(text) && tryJson(`${root}/architecture.json`)),
    implementerMeaningful: role !== 'implementer' || (((/export\s+function\s+createWebhookApp/.test(indexText) || /export\s*\{[^}]*\bcreateWebhookApp\b[^}]*\}/s.test(indexText)) && /\breceive\b/.test(indexText + '\n' + sourceText) && /\bprocessNext\b/.test(indexText + '\n' + sourceText) && /\breplay\b/.test(indexText + '\n' + sourceText))),
    testWriterMeaningful: role !== 'test_writer' || (/node:test|from ['"]node:test/.test(text) && /idempot|replay|process/i.test(text)),
    reviewerMeaningful: role !== 'adversarial_reviewer' || /risk|counterexample|verdict|idempot|replay/i.test(text),
    scorerMeaningful: role !== 'scorer_refiner' || /score|strength|weakness|winner|recommend/i.test(text)
  };
  return { ok: Object.values(checks).every(Boolean), expected, missing, checks };
}

async function runGoldenBehavior() {
  const modulePath = abs(`${root}/src/index.mjs`);
  if (!fs.existsSync(modulePath)) return { ok: false, reason: 'index_missing' };
  let mod;
  try { mod = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`); }
  catch (error) { return { ok: false, reason: 'import_failed', error: error.message }; }
  if (typeof mod.createWebhookApp !== 'function') return { ok: false, reason: 'createWebhookApp_missing' };
  let tick = 0;
  const clock = () => `2026-06-14T00:00:${String(tick++).padStart(2, '0')}.000Z`;
  clock.now = clock;
  const app = mod.createWebhookApp({ clock, now: clock, idFactory: (prefix = 'evt') => `${prefix}_${tick++}` });
  const recordOf = (value) => {
    if (!value || typeof value !== 'object') return value;
    if (value.record && typeof value.record === 'object') return value.record;
    if (value.event && typeof value.event === 'object') return value.event;
    if (value.webhook && typeof value.webhook === 'object') return value.webhook;
    if (value.result?.record && typeof value.result.record === 'object') return value.result.record;
    return value;
  };
  const statusOf = (value) => {
    const record = recordOf(value);
    return record?.status || value?.record?.status || value?.event?.status || value?.status || null;
  };
  const idOf = (value) => recordOf(value)?.id || value?.id || null;
  try {
    const first = app.receive({ id: 'evt_1', type: 'contact.created', payload: { email: 'a@example.com' } }, { 'idempotency-key': 'idem-1' });
    const dupe = app.receive({ id: 'evt_1b', type: 'contact.created', payload: { email: 'b@example.com' } }, { 'idempotency-key': 'idem-1' });
    const firstRecord = recordOf(first);
    const dupeRecord = recordOf(dupe);
    if (!firstRecord || !idOf(firstRecord)) throw new Error('receive did not return a record with id');
    if (!['received', 'pending', 'accepted', 'queued'].includes(statusOf(first)) && !['received', 'pending', 'accepted', 'queued'].includes(statusOf(firstRecord))) throw new Error('receive did not expose received/pending/accepted/queued semantics');
    if (idOf(dupeRecord) !== idOf(firstRecord)) throw new Error('idempotency dedupe did not return original record');
    const processed = await app.processNext(async (record) => ({ delivered: record.id }));
    const processedStatus = statusOf(processed);
    if (!processed || !['processed', 'success', 'succeeded'].includes(processedStatus)) throw new Error(`processNext did not process first event: ${processedStatus}`);
    const second = app.receive({ id: 'evt_2', type: 'invoice.paid', payload: { amount: 42 } });
    const secondId = idOf(second);
    const failed = await app.processNext(async () => { throw new Error('downstream unavailable'); });
    const failedStatus = statusOf(failed);
    if (!failed || !['failed', 'error'].includes(failedStatus)) throw new Error(`processNext failure did not mark failed: ${failedStatus}`);
    const replayTarget = idOf(failed) || secondId;
    const outboxBefore = Array.isArray(app.outbox()) ? app.outbox().length : 0;
    const replayed = await app.replay(replayTarget, async (record) => ({ replayed: record.id }));
    const replayStatus = statusOf(replayed);
    const outboxAfter = Array.isArray(app.outbox()) ? app.outbox().length : 0;
    if (!replayed || (!['processed', 'success', 'succeeded', 'replayed', 'completed'].includes(replayStatus) && outboxAfter <= outboxBefore)) throw new Error(`replay did not process or enqueue result: ${replayStatus}`);
    if (!Array.isArray(app.outbox()) || app.outbox().length < 1) throw new Error('replay did not enqueue outbox metadata');
    const invoiceList = app.list({ type: 'invoice.paid' });
    if (!Array.isArray(invoiceList) || invoiceList.length !== 1) throw new Error('list filter by type failed');
    const stats = app.stats();
    if (!stats || Number(stats.total ?? stats.received ?? stats.count ?? 0) < 2) throw new Error('stats total/received count missing');
    return { ok: true, checks: ['receive', 'idempotency', 'process_success', 'process_failure', 'replay', 'outbox', 'list', 'stats'] };
  } catch (error) {
    return { ok: false, reason: 'behavior_failed', error: error.message };
  }
}

function architectureMetrics() {
  const architecture = tryJson(`${root}/architecture.json`) || {};
  const files = allCandidateFiles(candidateId).filter(exists);
  const text = allExistingText(files);
  const sourceText = allExistingText(candidateSourceFiles(candidateId).filter(exists));
  const layers = Array.isArray(architecture.layers) ? architecture.layers.map(String).filter(Boolean) : [];
  const lineCount = files.reduce((sum, rel) => sum + countLines(rel), 0);
  const fileCount = files.length;
  const duplicateRouteRegistration = (text.match(/(?:router|server|expressApp)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]/g) || []).length > 1;
  const markerOnly = /transferBenchmarkEvidence|semanticProductArchitecture|TODO_ONLY_MARKER/.test(text);
  const hasCreateWebhookApp = /export\s+function\s+createWebhookApp/.test(sourceText);
  const hasIdempotency = /idempot|dedupe|idempotencyKey/i.test(text);
  const hasReplay = /replay/i.test(text) && /outbox|history|queue/i.test(text);
  const hasFailureLifecycle = /failed|lastError|error/i.test(text);
  const hasReviewArtifacts = candidateReviewFiles(candidateId).every(exists) && candidateScoreFiles(candidateId).every(exists);
  const layerCount = Math.max(layers.length, new Set(candidateSourceFiles(candidateId).filter(exists).map((rel) => rel.split('/').at(-1)?.replace(/\.mjs$/, ''))).size >= 3 ? 3 : 1);
  const behavior = 40;
  const verifierScore = 10;
  const layering = Math.min(18, layerCount * 3);
  const separation = Math.min(12, Math.max(0, fileCount - 4) * 1.2);
  const reviewability = lineCount > 0 ? Math.max(0, 12 - Math.max(0, Math.ceil((lineCount - 420) / 100))) : 0;
  const intent = architecture.rationale || architecture.pattern || architecture.title ? 8 : 2;
  const replayFit = hasIdempotency && hasReplay && hasFailureLifecycle ? 10 : hasReplay ? 6 : 0;
  const rawScore = Number((behavior + verifierScore + layering + separation + reviewability + intent + replayFit).toFixed(2));
  return {
    architecture,
    layers,
    layerCount,
    fileCount,
    lineCount,
    duplicateRouteRegistration,
    markerOnly,
    hasCreateWebhookApp,
    hasIdempotency,
    hasReplay,
    hasFailureLifecycle,
    hasReviewArtifacts,
    architectureScore: Math.min(100, rawScore),
    rawScore,
    scoreBreakdown: { behavior, verifier: verifierScore, layering, separation, reviewability, intent, replayFit },
    scoringNote: 'Dynamic real-Codex rubric: behavior + verifier + layering + separation + reviewability + declared intent + replay/idempotency fit.'
  };
}

if (verifier === 'role') {
  const result = expectedRoleOk();
  out({
    ok: result.ok,
    verifier,
    command: 'role artifact verifier',
    durationMs: 0,
    stdout: '',
    stderr: result.ok ? '' : JSON.stringify({ missing: result.missing, checks: result.checks }),
    metadata: { candidateId, role, explorationSeed: candidateSeed(candidateId), ...result }
  }, result.ok);
}

if (verifier === 'behavior') {
  const startedAt = Date.now();
  const behavior = await runGoldenBehavior();
  out({
    ok: behavior.ok,
    verifier,
    command: 'dynamic golden behavior verifier',
    durationMs: Date.now() - startedAt,
    stdout: behavior.ok ? JSON.stringify(behavior) : '',
    stderr: behavior.ok ? '' : JSON.stringify(behavior),
    metadata: { candidateId, role, behaviorCoverage: behavior.checks || [], reason: behavior.reason || null }
  }, behavior.ok);
}

if (verifier === 'architecture') {
  const metrics = architectureMetrics();
  const ok = metrics.hasCreateWebhookApp && metrics.hasIdempotency && metrics.hasReplay && metrics.hasFailureLifecycle && metrics.hasReviewArtifacts && !metrics.duplicateRouteRegistration && !metrics.markerOnly;
  out({
    ok,
    verifier,
    command: 'dynamic real Codex architecture verifier',
    durationMs: 0,
    stdout: '',
    stderr: ok ? '' : JSON.stringify(metrics),
    metadata: { candidateId, role, ...metrics }
  }, ok);
}

fail(`Unknown verifier ${verifier}`);
