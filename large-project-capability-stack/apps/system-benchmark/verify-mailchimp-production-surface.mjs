#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = {
    surfaceId: null,
    file: null,
    test: null,
    requireNormalFlow: process.env.MAILCHIMP_BENCHMARK_REQUIRE_NORMAL_FLOW === '1',
    requireExistingProductNormalFlow: process.env.MAILCHIMP_BENCHMARK_REQUIRE_EXISTING_PRODUCT_NORMAL_FLOW === '1',
    durationMs: Number(process.env.MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS || 0),
    minCycles: Number(process.env.MAILCHIMP_BENCHMARK_SURFACE_MIN_CYCLES || 1),
    cycleIntervalMs: Number(process.env.MAILCHIMP_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS || 60000)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file') {
      args.file = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--test') {
      args.test = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--duration-ms') {
      args.durationMs = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (token === '--min-cycles') {
      args.minCycles = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (token === '--cycle-interval-ms') {
      args.cycleIntervalMs = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (token === '--require-normal-flow') {
      args.requireNormalFlow = true;
      continue;
    }
    if (token === '--require-existing-product-normal-flow') {
      args.requireNormalFlow = true;
      args.requireExistingProductNormalFlow = true;
      continue;
    }
    if (!token.startsWith('--') && !args.surfaceId) args.surfaceId = token;
  }
  return {
    surfaceId: args.surfaceId,
    file: args.file,
    test: args.test,
    requireNormalFlow: args.requireNormalFlow === true,
    requireExistingProductNormalFlow: args.requireExistingProductNormalFlow === true,
    durationMs: Math.max(0, Number.isFinite(args.durationMs) ? args.durationMs : 0),
    minCycles: Math.max(1, Number.isFinite(args.minCycles) ? args.minCycles : 1),
    cycleIntervalMs: Math.max(250, Number.isFinite(args.cycleIntervalMs) ? args.cycleIntervalMs : 60000)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRelPath(root, relPath, label) {
  if (!relPath || path.isAbsolute(relPath) || String(relPath).includes('..')) {
    throw new Error(`${label}_path_out_of_scope`);
  }
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label}_path_out_of_scope`);
  return resolved;
}

function truncate(value, maxChars = 6000) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.floor(maxChars * 0.7))}\n...[truncated ${text.length - maxChars} chars]...\n${text.slice(-Math.floor(maxChars * 0.3))}`;
}

function runCommand(command, args, cwd) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    stdio: 'pipe'
  });
  return {
    ok: result.status === 0,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    stdout: truncate(result.stdout || ''),
    stderr: truncate(result.stderr || '')
  };
}

function assertFileLooksLikeProductSurface(repoRoot, relFile) {
  const fullPath = safeRelPath(repoRoot, relFile, 'surface_file');
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error('surface_file_missing');
  }
  if (!/^(apps|packages)\//.test(relFile)) {
    throw new Error('surface_file_not_product_path');
  }
  if (!/\.(mjs|js|ts|tsx|jsx)$/i.test(relFile)) {
    throw new Error('surface_file_not_source_code');
  }
  const source = fs.readFileSync(fullPath, 'utf8');
  if (source.trim().length < 80) throw new Error('surface_file_too_small_for_production_slice');
  if (!/\b(export|import|function|const|class)\b/.test(source)) {
    throw new Error('surface_file_lacks_module_signals');
  }
  return { fullPath, bytes: Buffer.byteLength(source), lineCount: source.split('\n').length };
}

async function importFresh(fullPath) {
  const url = pathToFileURL(fullPath);
  return import(`${url.href}?mailchimpSurfaceVerifier=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function probeCreateServer(module) {
  if (typeof module.createServer !== 'function') return { required: false, ok: true, reason: 'createServer_export_missing' };
  const server = module.createServer();
  if (!server || typeof server.listen !== 'function') return { required: true, ok: false, reason: 'createServer_did_not_return_http_server' };
  const address = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const catalog = await fetch(`${base}/catalog.json`);
    const catalogText = await catalog.text();
    const home = await fetch(`${base}/`);
    const homeText = await home.text();
    return {
      required: true,
      ok: catalog.status >= 200 && catalog.status < 500 && home.status >= 200 && home.status < 500,
      reason: 'http_server_probe_executed',
      catalogStatus: catalog.status,
      catalogBytes: catalogText.length,
      homeStatus: home.status,
      homeBytes: homeText.length
    };
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

function countRuntimeReferences(source = '', runtimeName = '') {
  if (!runtimeName) return 0;
  const escaped = runtimeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (String(source || '').match(new RegExp(escaped, 'g')) || []).length;
}

async function verifyStrictProductSurfaceRuntimeExecution({ fullPath, source, surfaceId, requireNormalFlow = false, requireExistingProductNormalFlow = false }) {
  if (!/mailchimpStrictProductSurface(?:Runtime|IntegratedCall|Contract)_/.test(String(source || ''))) {
    return { required: false, ok: true, reason: 'strict_product_surface_runtime_not_present' };
  }
  const module = await importFresh(fullPath);
  const runtimeEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('mailchimpStrictProductSurfaceRuntime_') && typeof value === 'function');
  const integrationEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('mailchimpStrictProductSurfaceIntegratedCall_') && typeof value === 'function');
  const normalFlowEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('mailchimpStrictProductSurfaceNormalFlow_') && typeof value === 'function');
  const contractEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('mailchimpStrictProductSurfaceContract_') && value?.surfaceId === surfaceId);

  const [contractName] = contractEntries[0] || [];
  const contractSuffix = contractName?.replace(/^mailchimpStrictProductSurfaceContract_/, '') || null;
  const preferredRuntimeName = contractSuffix ? `mailchimpStrictProductSurfaceRuntime_${contractSuffix}` : null;
  const preferredIntegrationName = contractSuffix ? `mailchimpStrictProductSurfaceIntegratedCall_${contractSuffix}` : null;
  const preferredNormalFlowName = contractSuffix ? `mailchimpStrictProductSurfaceNormalFlow_${contractSuffix}` : null;
  const [runtimeName, runtimeFn] = (preferredRuntimeName && runtimeEntries.find(([name]) => name === preferredRuntimeName)) || runtimeEntries[0] || [];
  const [integrationName, integrationFn] = (preferredIntegrationName && integrationEntries.find(([name]) => name === preferredIntegrationName)) || integrationEntries[0] || [];
  const [normalFlowName, normalFlowFn] = (preferredNormalFlowName && normalFlowEntries.find(([name]) => name === preferredNormalFlowName)) || normalFlowEntries[0] || [];
  if (!runtimeName || !runtimeFn) return { required: true, ok: false, reason: 'strict_product_surface_runtime_export_missing', runtimeExportCount: runtimeEntries.length, integrationExportCount: integrationEntries.length, contractExportCount: contractEntries.length };
  if (!integrationName || !integrationFn) return { required: true, ok: false, reason: 'strict_product_surface_integration_export_missing', runtimeExportCount: runtimeEntries.length, integrationExportCount: integrationEntries.length, contractExportCount: contractEntries.length };
  if (contractEntries.length === 0) return { required: true, ok: false, reason: 'strict_product_surface_contract_export_missing', runtimeExportCount: runtimeEntries.length, integrationExportCount: integrationEntries.length, contractExportCount: contractEntries.length };

  const runtimeReferenceCount = countRuntimeReferences(source, runtimeName);
  if (runtimeReferenceCount < 2) {
    return { required: true, ok: false, reason: 'strict_product_surface_runtime_export_only', runtimeName, integrationName, runtimeReferenceCount };
  }

  const storeWrites = [];
  globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs = [];
  const context = {
    now: new Date().toISOString(),
    actorId: 'mailchimp-strict-surface-verifier',
    events: [{ type: `${surfaceId}.strict_verifier_existing_product_path`, surfaceId }],
    store: {
      save(record) {
        const saved = { ...record, saved: true };
        storeWrites.push(saved);
        return saved;
      }
    }
  };
  const runtimeResult = runtimeFn({ entityId: `${surfaceId}-strict-runtime-proof`, state: 'approved', actorId: 'mailchimp-strict-surface-verifier' }, context);
  const integrationResult = integrationFn({ entityId: `${surfaceId}-strict-integration-proof`, state: 'approved', actorId: 'mailchimp-strict-surface-verifier' }, context);
  const normalFlowResult = normalFlowFn ? normalFlowFn({ entityId: `${surfaceId}-strict-normal-flow-proof`, status: 'approved', actorId: 'mailchimp-strict-surface-verifier' }, context) : null;
  const normalFlowProofs = Array.isArray(globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs)
    ? globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs.filter((proof) => proof?.surfaceId === surfaceId || proof?.runtimeName === runtimeName)
    : [];
  const normalFlowProof = normalFlowResult?.normalFlowProof
    || normalFlowProofs.find((proof) => proof?.runtimeName === runtimeName && proof?.source === 'existing_product_function' && proof?.ok === true)
    || normalFlowProofs.find((proof) => proof?.ok === true)
    || null;

  const runtimeOk = runtimeResult?.ok === true
    && runtimeResult.surfaceId === surfaceId
    && runtimeResult.persisted?.saved === true
    && Array.isArray(runtimeResult.events)
    && runtimeResult.events.some((entry) => entry.type === `${surfaceId}.strict_state_transition`);
  const existingProductCall = integrationResult?.integration?.existingProductCall || null;
  const integrationOk = integrationResult?.ok === true
    && (integrationResult.integration?.strictRuntimeCalled === true || integrationResult.integration?.generatedRuntimeCalled === true)
    && existingProductCall?.attempted === true
    && existingProductCall?.ok === true;
  const normalFlowSourceOk = !requireExistingProductNormalFlow || normalFlowProof?.source === 'existing_product_function';
  const normalFlowOk = !requireNormalFlow || (normalFlowProof?.ok === true && normalFlowSourceOk);
  const apiProbe = await probeCreateServer(module);

  return {
    required: true,
    ok: runtimeOk && integrationOk && normalFlowOk,
    reason: runtimeOk && integrationOk && normalFlowOk ? 'strict_product_surface_runtime_executed' : 'strict_product_surface_runtime_execution_failed',
    runtimeName,
    integrationName,
    normalFlowName: normalFlowName || null,
    strictProductSurfaceRuntime: true,
    runtimeReferenceCount,
    runtimeExportCount: runtimeEntries.length,
    integrationExportCount: integrationEntries.length,
    normalFlowExportCount: normalFlowEntries.length,
    contractExportCount: contractEntries.length,
    storeWriteCount: storeWrites.length,
    runtimeResult: { ok: runtimeResult?.ok === true, eventCount: Array.isArray(runtimeResult?.events) ? runtimeResult.events.length : null, persistedSaved: runtimeResult?.persisted?.saved === true },
    integrationResult: {
      ok: integrationResult?.ok === true,
      strictRuntimeCalled: integrationResult?.integration?.strictRuntimeCalled === true,
      generatedRuntimeCalled: integrationResult?.integration?.generatedRuntimeCalled === true,
      existingProductCall
    },
    normalFlowRequired: requireNormalFlow,
    existingProductNormalFlowRequired: requireExistingProductNormalFlow,
    normalFlowSourceOk,
    normalFlowResult: normalFlowResult ? { ok: normalFlowResult?.ok === true, strictRuntimeCalled: normalFlowResult?.integration?.strictRuntimeCalled === true, existingProductCall: normalFlowResult?.integration?.existingProductCall || null, normalFlowProof: normalFlowResult?.normalFlowProof || null } : null,
    normalFlowProofCount: normalFlowProofs.length,
    normalFlowProof: normalFlowProof || null,
    apiProbe
  };
}

async function verifySemanticRuntimeExecution({ fullPath, source, surfaceId, requireNormalFlow = false, requireExistingProductNormalFlow = false }) {
  if (!/semanticProductArchitecture(?:Runtime|IntegratedCall|Contract)_/.test(String(source || ''))) {
    return { required: false, ok: true, reason: 'semantic_runtime_not_present' };
  }
  const module = await importFresh(fullPath);
  const runtimeEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('semanticProductArchitectureRuntime_') && typeof value === 'function');
  const integrationEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('semanticProductArchitectureIntegratedCall_') && typeof value === 'function');
  const normalFlowEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('semanticProductArchitectureNormalFlow_') && typeof value === 'function');
  const contractEntries = Object.entries(module)
    .filter(([name, value]) => name.startsWith('semanticProductArchitectureContract_') && value?.surfaceId === surfaceId);

  const [contractName] = contractEntries[0] || [];
  const contractSuffix = contractName?.replace(/^semanticProductArchitectureContract_/, '') || null;
  const preferredRuntimeName = contractSuffix ? `semanticProductArchitectureRuntime_${contractSuffix}` : null;
  const preferredIntegrationName = contractSuffix ? `semanticProductArchitectureIntegratedCall_${contractSuffix}` : null;
  const preferredNormalFlowName = contractSuffix ? `semanticProductArchitectureNormalFlow_${contractSuffix}` : null;
  const [runtimeName, runtimeFn] = (preferredRuntimeName && runtimeEntries.find(([name]) => name === preferredRuntimeName)) || runtimeEntries[0] || [];
  const [integrationName, integrationFn] = (preferredIntegrationName && integrationEntries.find(([name]) => name === preferredIntegrationName)) || integrationEntries[0] || [];
  const [normalFlowName, normalFlowFn] = (preferredNormalFlowName && normalFlowEntries.find(([name]) => name === preferredNormalFlowName)) || normalFlowEntries[0] || [];
  if (!runtimeName || !runtimeFn) return { required: true, ok: false, reason: 'semantic_runtime_export_missing', runtimeExportCount: runtimeEntries.length, integrationExportCount: integrationEntries.length, contractExportCount: contractEntries.length };
  if (!integrationName || !integrationFn) return { required: true, ok: false, reason: 'semantic_integration_export_missing', runtimeExportCount: runtimeEntries.length, integrationExportCount: integrationEntries.length, contractExportCount: contractEntries.length };
  if (contractEntries.length === 0) return { required: true, ok: false, reason: 'semantic_contract_export_missing', runtimeExportCount: runtimeEntries.length, integrationExportCount: integrationEntries.length, contractExportCount: contractEntries.length };

  const runtimeReferenceCount = countRuntimeReferences(source, runtimeName);
  if (runtimeReferenceCount < 2) {
    return { required: true, ok: false, reason: 'semantic_runtime_export_only', runtimeName, integrationName, runtimeReferenceCount };
  }

  const storeWrites = [];
  globalThis.__semanticProductArchitectureNormalFlowProofs = [];
  const context = {
    now: new Date().toISOString(),
    actorId: 'mailchimp-semantic-verifier',
    events: [{ type: `${surfaceId}.verifier_existing_product_path`, surfaceId }],
    store: {
      save(record) {
        const saved = { ...record, saved: true };
        storeWrites.push(saved);
        return saved;
      }
    }
  };
  const runtimeResult = runtimeFn({ entityId: `${surfaceId}-runtime-proof`, state: 'approved', actorId: 'mailchimp-semantic-verifier' }, context);
  const integrationResult = integrationFn({ entityId: `${surfaceId}-integration-proof`, state: 'approved', actorId: 'mailchimp-semantic-verifier' }, context);
  const normalFlowResult = normalFlowFn ? normalFlowFn({ entityId: `${surfaceId}-normal-flow-proof`, status: 'approved', actorId: 'mailchimp-semantic-verifier' }, context) : null;
  const normalFlowProofs = Array.isArray(globalThis.__semanticProductArchitectureNormalFlowProofs)
    ? globalThis.__semanticProductArchitectureNormalFlowProofs.filter((proof) => proof?.surfaceId === surfaceId || proof?.runtimeName === runtimeName)
    : [];
  const normalFlowProof = normalFlowProofs.find((proof) => proof?.runtimeName === runtimeName && proof?.ok === true) || normalFlowProofs.find((proof) => proof?.ok === true) || null;

  const runtimeOk = runtimeResult?.ok === true
    && runtimeResult.surfaceId === surfaceId
    && runtimeResult.persisted?.saved === true
    && Array.isArray(runtimeResult.events)
    && runtimeResult.events.some((entry) => entry.type === `${surfaceId}.state_transition`);
  const integrationOk = integrationResult?.ok === true
    && integrationResult.integration?.generatedRuntimeCalled === true
    && integrationResult.integration?.existingProductCall?.attempted === true
    && integrationResult.integration?.existingProductCall?.ok === true;
  const normalFlowSourceOk = !requireExistingProductNormalFlow || normalFlowProof?.source === 'existing_product_function';
  const normalFlowOk = !requireNormalFlow || (normalFlowProof?.ok === true && normalFlowSourceOk);
  const apiProbe = await probeCreateServer(module);

  return {
    required: true,
    ok: runtimeOk && integrationOk && normalFlowOk,
    reason: runtimeOk && integrationOk && normalFlowOk ? 'semantic_runtime_executed' : 'semantic_runtime_execution_failed',
    runtimeName,
    integrationName,
    normalFlowName: normalFlowName || null,
    runtimeReferenceCount,
    runtimeExportCount: runtimeEntries.length,
    integrationExportCount: integrationEntries.length,
    normalFlowExportCount: normalFlowEntries.length,
    contractExportCount: contractEntries.length,
    storeWriteCount: storeWrites.length,
    runtimeResult: { ok: runtimeResult?.ok === true, eventCount: Array.isArray(runtimeResult?.events) ? runtimeResult.events.length : 0, persistedSaved: runtimeResult?.persisted?.saved === true },
    integrationResult: {
      ok: integrationResult?.ok === true,
      generatedRuntimeCalled: integrationResult?.integration?.generatedRuntimeCalled === true,
      existingProductCall: integrationResult?.integration?.existingProductCall || null
    },
    normalFlowRequired: requireNormalFlow,
    existingProductNormalFlowRequired: requireExistingProductNormalFlow,
    normalFlowSourceOk,
    normalFlowResult: normalFlowResult ? { ok: normalFlowResult?.ok === true, generatedRuntimeCalled: normalFlowResult?.integration?.generatedRuntimeCalled === true, existingProductCall: normalFlowResult?.integration?.existingProductCall || null } : null,
    normalFlowProofCount: normalFlowProofs.length,
    normalFlowProof: normalFlowProof || null,
    apiProbe
  };
}

async function runCycle({ repoRoot, surfaceId, relFile, relTest, cycle, requireNormalFlow, requireExistingProductNormalFlow }) {
  const fileEvidence = assertFileLooksLikeProductSurface(repoRoot, relFile);
  const checks = [];
  if (/\.(mjs|js)$/i.test(relFile)) {
    checks.push({ kind: 'syntax', ...runCommand(process.execPath, ['--check', relFile], repoRoot) });
  } else {
    checks.push({ kind: 'syntax_skipped', ok: true, reason: 'non_node_checkable_extension', command: null, durationMs: 0, stdout: '', stderr: '' });
  }

  if (relTest) {
    safeRelPath(repoRoot, relTest, 'test_file');
    if (!fs.existsSync(path.resolve(repoRoot, relTest))) throw new Error('test_file_missing');
    checks.push({ kind: 'node_test', ...runCommand(process.execPath, ['--test', '--test-concurrency=1', relTest], repoRoot) });
  }

  const source = fs.readFileSync(fileEvidence.fullPath, 'utf8');
  const strictProductSurfaceRuntimeExecution = await verifyStrictProductSurfaceRuntimeExecution({ fullPath: fileEvidence.fullPath, source, surfaceId, requireNormalFlow, requireExistingProductNormalFlow });
  const semanticRuntimeExecution = strictProductSurfaceRuntimeExecution.required
    ? strictProductSurfaceRuntimeExecution
    : await verifySemanticRuntimeExecution({ fullPath: fileEvidence.fullPath, source, surfaceId, requireNormalFlow, requireExistingProductNormalFlow });
  if (semanticRuntimeExecution.required) {
    checks.push({ kind: 'semantic_runtime_execution', ok: semanticRuntimeExecution.ok === true, semanticRuntimeExecution });
  }

  const ok = checks.every((entry) => entry.ok === true);
  return {
    ok,
    cycle,
    surfaceId,
    relFile,
    relTest: relTest || null,
    fileEvidence,
    semanticRuntimeExecution,
    checks
  };
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const repoRoot = process.cwd();
const cycles = [];
let firstMeaningfulProgressMs = null;
let error = null;

try {
  if (!args.surfaceId || !args.file) {
    throw new Error('usage: node verify-mailchimp-production-surface.mjs <surface-id> --file <product-file> [--test <test-file>] [--duration-ms <ms>]');
  }

  while (cycles.length < args.minCycles || Date.now() - startedAt < args.durationMs) {
    const cycle = await runCycle({
      repoRoot,
      surfaceId: args.surfaceId,
      relFile: args.file,
      relTest: args.test,
      cycle: cycles.length + 1,
      requireNormalFlow: args.requireNormalFlow,
      requireExistingProductNormalFlow: args.requireExistingProductNormalFlow
    });
    cycles.push(cycle);
    if (cycle.ok && firstMeaningfulProgressMs == null) {
      firstMeaningfulProgressMs = Date.now() - startedAt;
    }
    if (!cycle.ok) break;
    const elapsed = Date.now() - startedAt;
    if (cycles.length >= args.minCycles && elapsed >= args.durationMs) break;
    const remaining = Math.max(0, args.durationMs - elapsed);
    await sleep(Math.min(args.cycleIntervalMs, remaining || args.cycleIntervalMs));
  }
} catch (caught) {
  error = caught;
}

const durationMs = Date.now() - startedAt;
const ok = !error && cycles.length >= args.minCycles && durationMs >= args.durationMs && cycles.every((entry) => entry.ok);
const firstMeaningfulAt = firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null;
const semanticRuntimeExecution = [...cycles].reverse().find((cycle) => cycle.semanticRuntimeExecution?.required)?.semanticRuntimeExecution || null;
const checkKinds = Array.from(new Set(cycles.flatMap((cycle) => (cycle.checks || []).map((check) => check.kind).filter(Boolean))));
const includeFullCycles = /^(1|true|yes|on)$/i.test(String(process.env.MAILCHIMP_BENCHMARK_INCLUDE_FULL_CYCLES || ''));
const cycleSummaries = cycles.map((cycle) => ({
  ok: cycle.ok === true,
  cycle: cycle.cycle,
  surfaceId: cycle.surfaceId,
  checkKinds: (cycle.checks || []).map((check) => check.kind).filter(Boolean),
  failedChecks: (cycle.checks || [])
    .filter((check) => check.ok !== true)
    .map((check) => ({ kind: check.kind, reason: check.reason || check.semanticRuntimeExecution?.reason || null, exitCode: check.exitCode ?? null })),
  semanticRuntimeRequired: cycle.semanticRuntimeExecution?.required === true,
  semanticRuntimeOk: cycle.semanticRuntimeExecution?.required ? cycle.semanticRuntimeExecution?.ok === true : null,
  semanticRuntimeReason: cycle.semanticRuntimeExecution?.reason || null
}));

console.log(JSON.stringify({
  ok,
  scenarioId: args.surfaceId,
  surfaceId: args.surfaceId,
  file: args.file,
  test: args.test,
  durationMs,
  requestedDurationMs: args.durationMs,
  minCycles: args.minCycles,
  cycleIntervalMs: args.cycleIntervalMs,
  cyclesCompleted: cycles.length,
  checkKinds,
  firstMeaningfulProgressMs,
  firstMeaningfulProgressAt: firstMeaningfulAt,
  cycles: includeFullCycles ? cycles : cycleSummaries,
  cycleDetailsIncluded: includeFullCycles,
  semanticRuntimeExecution,
  error: error ? { name: error.name || 'Error', message: error.message || String(error) } : null
}));

process.exit(ok ? 0 : 2);
