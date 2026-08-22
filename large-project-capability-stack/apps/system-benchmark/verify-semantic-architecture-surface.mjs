#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = {
    surfaceId: null,
    file: null,
    companions: [],
    durationMs: Number(process.env.SEMANTIC_ARCHITECTURE_SURFACE_MIN_DURATION_MS || 0),
    minCycles: Number(process.env.SEMANTIC_ARCHITECTURE_SURFACE_MIN_CYCLES || 1),
    cycleIntervalMs: Number(process.env.SEMANTIC_ARCHITECTURE_SURFACE_CYCLE_INTERVAL_MS || 60000)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file') {
      args.file = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--companion') {
      args.companions.push(argv[index + 1]);
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
    if (!token.startsWith('--') && !args.surfaceId) args.surfaceId = token;
  }
  return {
    surfaceId: args.surfaceId,
    file: args.file,
    companions: args.companions.filter(Boolean),
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

function runSyntaxCheck(repoRoot, relFile) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ['--check', relFile], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 10
  });
  return {
    ok: result.status === 0,
    command: `${process.execPath} --check ${relFile}`,
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function assertProductSource(repoRoot, relFile, label) {
  const fullPath = safeRelPath(repoRoot, relFile, label);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error(`${label}_missing`);
  if (!/^(apps|packages)\//.test(relFile)) throw new Error(`${label}_not_product_path`);
  if (!/\.(mjs|js|ts|tsx|jsx)$/i.test(relFile)) throw new Error(`${label}_not_source_code`);
  const source = fs.readFileSync(fullPath, 'utf8');
  if (source.trim().length < 80) throw new Error(`${label}_too_small_for_semantic_surface`);
  return { fullPath, source, bytes: Buffer.byteLength(source), lineCount: source.split('\n').length };
}

function sourceHasSemanticSignals(source, surfaceId) {
  const text = String(source || '');
  return /semanticProductArchitectureRuntime_/.test(text)
    && /semanticProductArchitectureContract_/.test(text)
    && text.includes(surfaceId)
    && /context\.store\?\.save|store\.save/.test(text)
    && /events:\s*\[\.\.\.previousEvents/.test(text)
    && /telemetry\s*=\s*\{/.test(text)
    && !/transferBenchmarkEvidence_/.test(text);
}

async function importFresh(fullPath) {
  const url = pathToFileURL(fullPath);
  return import(`${url.href}?semanticVerifier=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function runCycle({ repoRoot, surfaceId, relFile, companions, cycle }) {
  const primary = assertProductSource(repoRoot, relFile, 'surface_file');
  const companionEvidence = companions.map((companion, index) => ({ relFile: companion, ...assertProductSource(repoRoot, companion, `companion_${index + 1}`) }));
  const candidateFiles = [{ relFile, ...primary }, ...companionEvidence];
  const runtimeCandidate = candidateFiles.find((entry) => sourceHasSemanticSignals(entry.source, surfaceId));
  if (!runtimeCandidate) throw new Error('semantic_runtime_signals_missing');
  const syntaxChecks = candidateFiles.map((entry) => ({ kind: 'syntax', relFile: entry.relFile, ...runSyntaxCheck(repoRoot, entry.relFile) }));
  if (syntaxChecks.some((entry) => entry.ok !== true)) return { ok: false, cycle, surfaceId, relFile, companions, checks: syntaxChecks };

  const module = await importFresh(runtimeCandidate.fullPath);
  const runtimeEntries = Object.entries(module).filter(([name, value]) => name.startsWith('semanticProductArchitectureRuntime_') && typeof value === 'function');
  const contractEntries = Object.entries(module).filter(([name, value]) => name.startsWith('semanticProductArchitectureContract_') && value?.surfaceId === surfaceId);
  if (runtimeEntries.length === 0) throw new Error('semantic_runtime_export_missing');
  if (contractEntries.length === 0) throw new Error('semantic_contract_export_missing');

  const storeWrites = [];
  const runtimeResults = runtimeEntries.map(([name, fn], index) => {
    const result = fn({ entityId: `${surfaceId}-${cycle}-${index + 1}`, state: 'approved', actorId: 'semantic-verifier' }, {
      now: new Date().toISOString(),
      events: [{ type: `${surfaceId}.baseline_loaded`, surfaceId }],
      store: {
        save(record) {
          const saved = { ...record, saved: true };
          storeWrites.push(saved);
          return saved;
        }
      }
    });
    return { name, result };
  });

  const runtimeOk = runtimeResults.every(({ result }) => result?.ok === true
    && result.surfaceId === surfaceId
    && result.persisted?.saved === true
    && Array.isArray(result.events)
    && result.events.some((entry) => entry.type === `${surfaceId}.state_transition`)
    && result.telemetry?.integrationPointCount >= 2);

  return {
    ok: runtimeOk,
    cycle,
    surfaceId,
    relFile,
    runtimeFile: runtimeCandidate.relFile,
    companions,
    primaryEvidence: { bytes: primary.bytes, lineCount: primary.lineCount },
    companionEvidence: companionEvidence.map((entry) => ({ bytes: entry.bytes, lineCount: entry.lineCount })),
    checks: syntaxChecks,
    runtimeExportCount: runtimeEntries.length,
    contractExportCount: contractEntries.length,
    storeWriteCount: storeWrites.length,
    runtimeResults: runtimeResults.map(({ name, result }) => ({ name, ok: result?.ok === true, eventCount: Array.isArray(result?.events) ? result.events.length : 0, telemetry: result?.telemetry || null }))
  };
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const repoRoot = process.cwd();
const cycles = [];
let firstMeaningfulProgressMs = null;
let error = null;

try {
  if (!args.surfaceId || !args.file) throw new Error('usage: node verify-semantic-architecture-surface.mjs <surface-id> --file <product-file> [--companion <product-file>]');
  while (cycles.length < args.minCycles || Date.now() - startedAt < args.durationMs) {
    const cycle = await runCycle({ repoRoot, surfaceId: args.surfaceId, relFile: args.file, companions: args.companions, cycle: cycles.length + 1 });
    cycles.push(cycle);
    if (cycle.ok && firstMeaningfulProgressMs == null) firstMeaningfulProgressMs = Date.now() - startedAt;
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
const ok = !error && cycles.length >= args.minCycles && durationMs >= args.durationMs && cycles.every((entry) => entry.ok === true);
const firstMeaningfulAt = firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null;

console.log(JSON.stringify({
  ok,
  scenarioId: args.surfaceId,
  surfaceId: args.surfaceId,
  file: args.file,
  companions: args.companions,
  durationMs,
  requestedDurationMs: args.durationMs,
  minCycles: args.minCycles,
  cycleCount: cycles.length,
  firstMeaningfulProgressMs,
  firstMeaningfulProgressAt: firstMeaningfulAt,
  cycles,
  error: error ? { message: error.message, stack: String(error.stack || '').split('\n').slice(0, 8) } : null
}, null, 2));

process.exit(ok ? 0 : 2);
