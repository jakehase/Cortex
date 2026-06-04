#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) out._.push(arg);
    else if (arg.includes('=')) {
      const [key, ...rest] = arg.slice(2).split('=');
      out[key] = rest.join('=');
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
      else out[key] = true;
    }
  }
  return out;
}

function shellQuote(value = '') {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function envFile(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n') + '\n';
}

const args = parseArgs(process.argv.slice(2));
const contractPath = args.contract || args._[0];
if (!contractPath) {
  console.error('usage: node apps/system-benchmark/prepare-creative-compact-ab-canary.mjs --contract <run_contract.json> [--out <dir>] [--surface-count 10]');
  process.exit(2);
}
const contract = readJson(contractPath, null);
if (!contract) {
  console.error(`contract_not_readable:${contractPath}`);
  process.exit(1);
}
const surfaces = Array.isArray(contract.scope?.surfaces) ? contract.scope.surfaces : [];
const surfaceCount = Math.max(1, Math.min(surfaces.length || 1, Number(args['surface-count'] || process.env.CREATIVE_AB_CANARY_SURFACE_COUNT || 10)));
const selectedSurfaces = surfaces.slice(0, surfaceCount).map((surface) => ({ id: surface.id, title: surface.title || surface.label || surface.id }));
const outDir = path.resolve(args.out || process.env.CREATIVE_AB_CANARY_OUT_DIR || path.join(path.dirname(contractPath), `creative-compact-ab-canary-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`));
fs.mkdirSync(outDir, { recursive: true });

const common = {
  CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: process.env.CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE || '1',
  CODEX_CREATIVE_MAX_ITERATIONS: process.env.CODEX_CREATIVE_MAX_ITERATIONS || '2',
  CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: process.env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT || '2',
  CREATIVE_WORKER_CORTEX_REQUIRED: process.env.CREATIVE_WORKER_CORTEX_REQUIRED || '1',
  CREATIVE_WORKER_BUDGET_REQUIRED: process.env.CREATIVE_WORKER_BUDGET_REQUIRED || '1',
  CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || '100000',
  CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || '2',
  CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: process.env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT || String(surfaceCount * 2),
  CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || String(Math.max(600000, surfaceCount * 140000)),
  CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE: process.env.CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE || '180000',
  CREATIVE_WORKER_BURN_RATE_WINDOW_MS: process.env.CREATIVE_WORKER_BURN_RATE_WINDOW_MS || '600000'
};

const fullContext = {
  ...common,
  CREATIVE_WORKER_PROMPT_MODE: 'full_context',
  CREATIVE_WORKER_CODEX_RUN_TESTS: process.env.CREATIVE_WORKER_CODEX_RUN_TESTS_FULL || '1',
  CREATIVE_WORKER_EXTERNAL_VERIFICATION: process.env.CREATIVE_WORKER_EXTERNAL_VERIFICATION_FULL || '0'
};

const compact = {
  ...common,
  CREATIVE_WORKER_PROMPT_MODE: 'compact',
  CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || '4000',
  CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
  CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
  CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
  CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1'
};

fs.writeFileSync(path.join(outDir, 'full-context.env'), envFile(fullContext));
fs.writeFileSync(path.join(outDir, 'compact.env'), envFile(compact));
const plan = {
  schemaVersion: 'claw.creative_compact_ab_canary_plan.v1',
  generatedAt: new Date().toISOString(),
  contractPath: path.resolve(contractPath),
  benchmarkId: contract.benchmarkId || null,
  runId: contract.runId || null,
  selectedSurfaceCount: selectedSurfaces.length,
  selectedSurfaces,
  variants: {
    full_context: { envFile: path.join(outDir, 'full-context.env'), compareAs: 'baseline_full_context' },
    compact: { envFile: path.join(outDir, 'compact.env'), compareAs: 'candidate_compact_fail_closed' }
  },
  compareMetrics: [
    'tokensObserved per merged surface',
    'merged product files and landed product diff',
    'targeted verifier pass/fail',
    'generic/shim rejection rate',
    'time-to-meaningful-progress',
    'provider usage-limit or burn-rate stops'
  ],
  rampRule: 'Ramp only if compact quality is equal to full-context on verifier pass, landed product delta, and shim rejection metrics while reducing token cost.'
};
fs.writeFileSync(path.join(outDir, 'canary-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'README.md'), `# Creative compact A/B canary\n\nThis prepares env overlays only; it does not launch a benchmark.\n\n1. Run the same ${selectedSurfaces.length}-surface contract subset once with \`full-context.env\`.\n2. Run the same subset once with \`compact.env\`.\n3. Compare \`creative-worker-budget-ledger.json\`, landed product diff, verifier outcomes, shim/generic rejection rate, and time-to-meaningful-progress.\n\nDo not ramp compact mode unless quality is equal and token cost is lower.\n`);
console.log(JSON.stringify({ ok: true, outDir, selectedSurfaceCount: selectedSurfaces.length, planPath: path.join(outDir, 'canary-plan.json') }, null, 2));
