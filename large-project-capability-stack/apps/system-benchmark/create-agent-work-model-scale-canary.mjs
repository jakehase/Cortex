#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeCortexAgentWorkHandoff } from '../../packages/cortex-agent-work-adapter/index.mjs';

function parseArgs(argv) {
  const args = {
    out: null,
    fixtureRoot: null,
    repoPath: null,
    artifactRoot: null,
    runId: null,
    benchmarkId: null,
    surfaceCount: 10,
    benchmarkTier: null,
    mode: 'short',
    enduranceMs: 0,
    executionBoundary: 'remote_execution_required',
    workerCommand: null,
    officialVerifierOnly: false,
    maxWaves: 1
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = next; index += 1; continue; }
    if (token === '--fixture-root') { args.fixtureRoot = next; index += 1; continue; }
    if (token === '--repo' || token === '--repo-path') { args.repoPath = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--run-id') { args.runId = next; index += 1; continue; }
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--surface-count' || token === '--surfaces' || token === '--agents' || token === '--agent-count') { args.surfaceCount = Number(next); index += 1; continue; }
    if (token === '--benchmark-tier') { args.benchmarkTier = next; index += 1; continue; }
    if (token === '--mode') { args.mode = String(next || '').trim(); index += 1; continue; }
    if (token === '--endurance-ms') { args.enduranceMs = Number(next); index += 1; continue; }
    if (token === '--endurance-minutes') { args.enduranceMs = Number(next) * 60_000; index += 1; continue; }
    if (token === '--execution-boundary') { args.executionBoundary = next; index += 1; continue; }
    if (token === '--worker-command') { args.workerCommand = next; index += 1; continue; }
    if (token === '--official-verifier-only') { args.officialVerifierOnly = true; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
  }
  return args;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function sanitizeId(value, fallback) {
  return String(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

const STACK_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const CREATIVE_WORKER_SCRIPT = path.join(STACK_ROOT, 'apps/system-benchmark/codex-creative-worker.mjs');

function normalizeMode(value) {
  const mode = String(value || 'short').trim().toLowerCase().replace(/[-_ ]+/g, '_');
  if (['short', 'execution_smoke', 'scale_smoke'].includes(mode)) return 'short';
  if (['endurance', 'official_endurance', 'official_verifier_endurance', '30m'].includes(mode)) return 'official_endurance';
  throw new Error(`unknown mode: ${value}`);
}

function normalizeWorkerCommand(value) {
  const raw = String(value || '').trim();
  if (!raw) return `node ${CREATIVE_WORKER_SCRIPT}`;
  return raw.replace(/^(node\s+)(\.\/)?apps\/system-benchmark\/codex-creative-worker\.mjs(\b)/, `$1${CREATIVE_WORKER_SCRIPT}$3`);
}

function createSurfaceFiles({ fixtureRoot, index, mode, enduranceMs }) {
  const suffix = pad(index);
  const idPrefix = mode === 'official_endurance' ? 'model_product_endurance' : 'model_product_canary';
  const productDir = mode === 'official_endurance' ? `endurance-${suffix}` : `canary-${suffix}`;
  const fnPrefix = mode === 'official_endurance' ? 'agentWorkEnduranceCanary' : 'agentWorkScaleCanary';
  const kindPrefix = mode === 'official_endurance' ? 'agent-work-endurance-canary' : 'agent-work-scale-canary';
  const id = `${idPrefix}_${suffix}`;
  const fn = `${fnPrefix}${suffix}`;
  const kind = `${kindPrefix}-${suffix}`;
  const productFile = `packages/${productDir}/index.mjs`;
  const testFile = `tests/${productDir}.test.mjs`;

  write(path.join(fixtureRoot, productFile), `export function ${fn}(input = {}) {\n  return {\n    ok: false,\n    kind: '${kind}',\n    source: input.source || 'initial',\n    verified: false,\n    slot: ${index},\n    implementedBy: 'pending-model-worker'\n  };\n}\n`);

  const expectedContract = `{ ok: true, kind: '${kind}', source: 'codex-worker', verified: true, slot: ${index}, implementedBy: 'model-worker' }`;
  const semanticAdmissionInstruction = 'The merge gate rejects source-syntax-only deltas: do not only flip literal return values; add a small named runtime helper, contract builder, normalizer, or equivalent product logic while preserving the exact public return shape.';
  const commonExpected = `const expected = {\n  ok: true,\n  kind: '${kind}',\n  source: 'codex-worker',\n  verified: true,\n  slot: ${index},\n  implementedBy: 'model-worker'\n};`;

  if (mode === 'official_endurance') {
    write(path.join(fixtureRoot, testFile), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { setTimeout as sleep } from 'node:timers/promises';\nimport { ${fn} } from '../${productFile}';\n\nconst enduranceMs = Math.max(0, Number(process.env.CANARY_ENDURANCE_MS || 0));\nconst intervalMs = Math.max(250, Math.min(5000, Number(process.env.CANARY_ENDURANCE_INTERVAL_MS || 5000)));\n${commonExpected}\n\ntest('${kind} remains verifier-green for the endurance window', async () => {\n  const deadline = Date.now() + enduranceMs;\n  let checks = 0;\n  do {\n    assert.deepEqual(${fn}({ source: 'codex-worker' }), expected);\n    checks += 1;\n    const remaining = deadline - Date.now();\n    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));\n  } while (Date.now() < deadline);\n  assert.ok(checks >= 1);\n});\n`);
  } else {
    write(path.join(fixtureRoot, testFile), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../${productFile}';\n\n${commonExpected}\n\ntest('${kind} is repaired by the model worker', () => {\n  assert.deepEqual(${fn}({ source: 'codex-worker' }), expected);\n});\n`);
  }

  const verification = mode === 'official_endurance'
    ? [`CANARY_ENDURANCE_MS=${enduranceMs} CANARY_ENDURANCE_INTERVAL_MS=5000 PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS=${enduranceMs} node --test ${testFile}`]
    : [`node --test ${testFile}`];

  return {
    id,
    label: mode === 'official_endurance'
      ? `Model worker endurance canary ${suffix}`
      : `Model worker product-diff canary ${suffix}`,
    goal: mode === 'official_endurance'
      ? `Repair ${productFile} so ${testFile} passes exactly and stays green for the ${Math.round(enduranceMs / 60000)} minute official verifier endurance window. Return exactly ${expectedContract}; do not add extra properties because the official verifier uses strict deep equality. ${semanticAdmissionInstruction}`
      : `Repair ${productFile} so ${testFile} passes exactly via a real product-code diff. Return exactly ${expectedContract}; do not add extra properties because the verifier uses strict deep equality. ${semanticAdmissionInstruction}`,
    files: [productFile],
    verify: verification
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error('usage: node apps/system-benchmark/create-agent-work-model-scale-canary.mjs --out <artifact-dir> [--fixture-root <repo>] [--artifact-root <run-root>] [--run-id <id>] [--surface-count N] [--mode short|official_endurance] [--endurance-minutes N] [--official-verifier-only] [--worker-command <command>]');
  process.exit(2);
}

try {
  const mode = normalizeMode(args.mode);
  const surfaceCount = Math.max(1, Number(args.surfaceCount || 1));
  const enduranceMs = mode === 'official_endurance'
    ? Math.max(1, Number(args.enduranceMs || 30 * 60_000))
    : 0;
  const outDir = path.resolve(args.out);
  const fixtureRoot = path.resolve(args.fixtureRoot || path.join(outDir, 'fixture-repo'));
  const repoPath = path.resolve(args.repoPath || fixtureRoot);
  const defaultBenchmarkId = mode === 'official_endurance'
    ? `agent_work_default_path_model_${surfaceCount}agent_30m`
    : `agent_work_default_path_model_${surfaceCount}agent`;
  const benchmarkId = sanitizeId(args.benchmarkId, defaultBenchmarkId);
  const runId = args.runId || `${benchmarkId}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const artifactRoot = path.resolve(args.artifactRoot || path.join(outDir, 'run'));
  const benchmarkTier = args.benchmarkTier || (mode === 'official_endurance' ? 'tier1_creative_product_30m' : 'execution_smoke');
  const workerCommand = normalizeWorkerCommand(args.workerCommand);
  fs.mkdirSync(outDir, { recursive: true });

  const surfaces = [];
  for (let index = 1; index <= surfaceCount; index += 1) {
    surfaces.push(createSurfaceFiles({ fixtureRoot, index, mode, enduranceMs }));
  }
  write(path.join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2) + '\n');

  const officialVerifierOnly = args.officialVerifierOnly || mode === 'official_endurance';
  const handoffInput = {
    objective: mode === 'official_endurance'
      ? `Prove Agent Work default objective-controller path can sustain ${surfaceCount} concurrent real model-worker product diffs through a ${Math.round(enduranceMs / 60000)} minute official verifier endurance window`
      : `Prove Agent Work default objective-controller path can drive ${surfaceCount} concurrent real model-worker product diffs and verifier passes`,
    goalId: mode === 'official_endurance'
      ? 'agent_work_default_path_model_endurance_canary'
      : 'agent_work_default_path_model_scale_canary',
    repoPath,
    benchmarkId,
    benchmarkTier,
    runId,
    artifactRoot,
    scoreboardPath: path.join(artifactRoot, 'scoreboard.json'),
    fidelity: 'production_slice',
    requestedAgentCount: surfaceCount,
    executionBoundary: args.executionBoundary,
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'relaunch_benchmark', 'touch_prod'] },
    doneWhen: mode === 'official_endurance'
      ? ['all_worker_product_diffs_landed', 'all_official_verifiers_pass_for_endurance_window', 'no_truth_layer_overclaim']
      : ['all_worker_product_diffs_landed', 'all_verifiers_pass', 'no_truth_layer_overclaim'],
    routeLevels: ['L5 oracle', 'L24 nexus', 'L27 forge', 'L34 validator'],
    wavePolicy: { max_waves: Math.max(1, Number(args.maxWaves || 1)), handoff: 'wave_factpack' },
    expansionPolicy: { triggers: [], max_cycles: 0 },
    surfaces,
    metadata: {
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        promptMode: 'compact',
        officialVerifierOnly,
        externalVerification: officialVerifierOnly ? false : undefined,
        workerCommand
      },
      canonicalLandingEvidence: {
        enabled: true,
        minAddedLineCount: 1,
        minUniqueNormalizedAddedLineCount: 1,
        duplicateLineRatioMax: 0.9
      },
      ...(mode === 'official_endurance' ? {
        durationTargetMinutes: Number((enduranceMs / 60000).toFixed(2)),
        workerTimeoutMs: Math.max(2 * enduranceMs, enduranceMs + 30 * 60_000),
        goThresholds: {
          productiveIterationRateMin: 1,
          noOpRateMax: 0,
          repeatBlockerRateMax: 0,
          handoffEfficiencyMin: 1,
          transferScoreMin: 1,
          minChangedProductFiles: surfaceCount,
          minUniqueAgents: surfaceCount
        }
      } : {})
    }
  };
  write(path.join(outDir, 'handoff_input.json'), JSON.stringify(handoffInput, null, 2) + '\n');
  const compiled = writeCortexAgentWorkHandoff({ input: handoffInput, outputDir: path.join(outDir, 'compiled'), options: { runId } });
  const recommendedRuntimeEnv = {
    BENCHMARK_HOST_ROLE: 'execution_plane',
    HOST_ROLE: 'execution_plane',
    CODEX_CREATIVE_MAX_ITERATIONS: '2',
    CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
    CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
    CREATIVE_WORKER_PROMPT_MODE: 'compact',
    CODEX_CREATIVE_PROMPT_MODE: 'compact',
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: String(surfaceCount),
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: String(surfaceCount * 2),
    ...(officialVerifierOnly ? { CREATIVE_WORKER_EXTERNAL_VERIFICATION: '0' } : { CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1' }),
    ...(mode === 'official_endurance' ? {
      TRANSFER_BENCHMARK_MAX_RUNTIME_MS: String(Math.max(2 * enduranceMs, enduranceMs + 90 * 60_000)),
      TRANSFER_BENCHMARK_WORKER_TIMEOUT_MS: String(Math.max(2 * enduranceMs, enduranceMs + 90 * 60_000)),
      ORCHESTRATOR_WORKER_TIMEOUT_MS: String(Math.max(2 * enduranceMs, enduranceMs + 90 * 60_000))
    } : {})
  };
  write(path.join(outDir, 'canary_meta.json'), JSON.stringify({
    runId,
    outDir,
    fixtureRoot,
    repoPath,
    artifactRoot,
    compiledDir: path.join(outDir, 'compiled'),
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    benchmarkId,
    benchmarkTier,
    mode,
    surfaceCount,
    requestedAgentCount: surfaceCount,
    enduranceMs,
    durationTargetMinutes: mode === 'official_endurance' ? enduranceMs / 60000 : null,
    officialVerifierOnly,
    workerCommand,
    recommendedRuntimeEnv,
    truthBoundary: mode === 'official_endurance'
      ? 'Official verifier commands are the endurance source of truth. Set CREATIVE_WORKER_EXTERNAL_VERIFICATION=0 for this mode to avoid double-paying the long verifier inside the creative worker.'
      : 'Short scale canary proves concurrent real product diffs and verifier passes; it is not an endurance proof.'
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    runId,
    outDir,
    fixtureRoot,
    repoPath,
    artifactRoot,
    benchmarkId,
    benchmarkTier,
    mode,
    surfaceCount,
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    officialVerifierOnly,
    productDiffMode: compiled.runContract.scope.productDiffMode,
    executionBoundary: compiled.runContract.executionBoundary
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
}
