#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPmhnpSiteTier2Surface } from './pmhnp-site-tier2-surfaces.mjs';

function parseArgs(argv) {
  const args = {
    surfaceId: null,
    durationMs: Number(process.env.PMHNP_SITE_BENCHMARK_SURFACE_MIN_DURATION_MS || process.env.PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS || 0),
    minCycles: Number(process.env.PMHNP_SITE_BENCHMARK_SURFACE_MIN_CYCLES || process.env.PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES || 1),
    cycleIntervalMs: Number(process.env.PMHNP_SITE_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS || process.env.PMHNP_BENCHMARK_SCENARIO_CYCLE_INTERVAL_MS || 60000)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
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
    durationMs: Math.max(0, Number.isFinite(args.durationMs) ? args.durationMs : 0),
    minCycles: Math.max(1, Number.isFinite(args.minCycles) ? args.minCycles : 1),
    cycleIntervalMs: Math.max(250, Number.isFinite(args.cycleIntervalMs) ? args.cycleIntervalMs : 60000)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRelPath(root, relPath) {
  if (!relPath || path.isAbsolute(relPath) || String(relPath).includes('..')) throw new Error('surface_path_out_of_scope');
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('surface_path_out_of_scope');
  return resolved;
}

function checkBalancedCss(source = '') {
  let depth = 0;
  for (const char of source) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function runCycle({ repoRoot, surface, cycle }) {
  const fullPath = safeRelPath(repoRoot, surface.file);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error('surface_file_missing');
  const source = fs.readFileSync(fullPath, 'utf8');
  const extension = path.extname(surface.file).toLowerCase();
  const checks = [];
  checks.push({ kind: 'file_exists', ok: true });
  checks.push({ kind: 'min_bytes', ok: Buffer.byteLength(source) >= Number(surface.minBytes || 500), actual: Buffer.byteLength(source), expected: Number(surface.minBytes || 500) });
  const lowerSource = source.toLowerCase();
  for (const token of surface.tokens || []) {
    checks.push({ kind: 'token_present', token, ok: lowerSource.includes(String(token).toLowerCase()) });
  }
  if (extension === '.html') {
    checks.push({ kind: 'html_document_signal', ok: /<(?:html|title|main|section|article|body)\b/i.test(source) });
    checks.push({ kind: 'html_product_language', ok: /PMHNP|billing|claim|credential|denial|telehealth/i.test(source) });
  } else if (extension === '.css') {
    checks.push({ kind: 'css_balanced_braces', ok: checkBalancedCss(source) });
    checks.push({ kind: 'css_selector_signal', ok: /[.#][A-Za-z0-9_-]+\s*[{,]/.test(source) });
  } else if (extension === '.js' || extension === '.mjs') {
    const syntax = spawnSync(process.execPath, ['--check', fullPath], { cwd: repoRoot, encoding: 'utf8' });
    checks.push({ kind: 'javascript_syntax', ok: syntax.status === 0, exitCode: syntax.status, stderr: (syntax.stderr || '').slice(0, 500) });
    checks.push({ kind: 'javascript_runtime_signal', ok: /(?:function|const|class|=>|querySelector|fetch|require\()/.test(source) });
  } else {
    checks.push({ kind: 'supported_static_extension', ok: false, extension });
  }
  const ok = checks.every((check) => check.ok === true);
  return {
    ok,
    cycle,
    surfaceId: surface.id,
    file: surface.file,
    checkKinds: checks.map((check) => check.kind),
    failedChecks: checks.filter((check) => check.ok !== true).map((check) => ({ kind: check.kind, token: check.token || null, actual: check.actual ?? null, expected: check.expected ?? null, exitCode: check.exitCode ?? null, stderr: check.stderr || null })),
    checks
  };
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const repoRoot = process.cwd();
const cycles = [];
let error = null;
let firstMeaningfulProgressMs = null;

try {
  const surface = getPmhnpSiteTier2Surface(args.surfaceId);
  if (!surface) throw new Error(`unknown_surface:${args.surfaceId || 'missing'}`);
  while (cycles.length < args.minCycles || Date.now() - startedAt < args.durationMs) {
    const cycle = runCycle({ repoRoot, surface, cycle: cycles.length + 1 });
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
const ok = !error && cycles.length >= args.minCycles && durationMs >= args.durationMs && cycles.every((cycle) => cycle.ok);
const firstMeaningfulProgressAt = firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null;
const checkKinds = Array.from(new Set(cycles.flatMap((cycle) => cycle.checkKinds || [])));
const includeFullCycles = /^(1|true|yes|on)$/i.test(String(process.env.PMHNP_SITE_BENCHMARK_INCLUDE_FULL_CYCLES || ''));

console.log(JSON.stringify({
  ok,
  scenarioId: args.surfaceId,
  surfaceId: args.surfaceId,
  durationMs,
  requestedDurationMs: args.durationMs,
  minCycles: args.minCycles,
  cycleIntervalMs: args.cycleIntervalMs,
  cyclesCompleted: cycles.length,
  firstMeaningfulProgressMs,
  firstMeaningfulProgressAt,
  checkKinds,
  cycles: includeFullCycles ? cycles : cycles.map((cycle) => ({ ok: cycle.ok, cycle: cycle.cycle, surfaceId: cycle.surfaceId, file: cycle.file, checkKinds: cycle.checkKinds, failedChecks: cycle.failedChecks })),
  cycleDetailsIncluded: includeFullCycles,
  error: error ? { name: error.name || 'Error', message: error.message || String(error) } : null
}));

process.exit(ok ? 0 : 2);
