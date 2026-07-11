#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCortexAgentWorkHandoff } from '../../packages/cortex-agent-work-adapter/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(SCRIPT_DIR, '../..');
const CREATIVE_WORKER_SCRIPT = path.join(STACK_ROOT, 'apps/system-benchmark/codex-creative-worker.mjs');

function parseArgs(argv) {
  const args = {
    out: null,
    aiosRoot: null,
    artifactRoot: null,
    runId: null,
    benchmarkId: 'agent_work_ai_os_product_platform_4agent',
    surfaceCount: 4,
    workerCommand: null,
    executionBoundary: 'remote_execution_required',
    maxWaves: 1
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--aios-root' || token === '--repo' || token === '--repo-path') { args.aiosRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || '').trim(); index += 1; continue; }
    if (token === '--benchmark-id') { args.benchmarkId = String(next || '').trim(); index += 1; continue; }
    if (token === '--surface-count' || token === '--surfaces' || token === '--agents' || token === '--agent-count') { args.surfaceCount = Number(next); index += 1; continue; }
    if (token === '--worker-command') { args.workerCommand = String(next || '').trim(); index += 1; continue; }
    if (token === '--execution-boundary') { args.executionBoundary = String(next || '').trim(); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
  }
  if (!args.out || !args.aiosRoot) {
    console.error('usage: node apps/system-benchmark/create-agent-work-aios-product-workload.mjs --out <artifact-dir> --aios-root <ai-os-repo> [--artifact-root <controller-run-root>] [--run-id <id>]');
    process.exit(2);
  }
  return args;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function normalizeWorkerCommand(value) {
  const raw = String(value || '').trim();
  if (!raw) return `node ${CREATIVE_WORKER_SCRIPT}`;
  return raw.replace(/^(node\s+)(\.\/)?apps\/system-benchmark\/codex-creative-worker\.mjs(\b)/, `$1${CREATIVE_WORKER_SCRIPT}$3`);
}

function ensureAiosRoot(root) {
  const packagePath = path.join(root, 'package.json');
  const cliPath = path.join(root, 'apps/aios-cli.mjs');
  if (!fs.existsSync(packagePath) || !fs.existsSync(cliPath)) {
    throw new Error(`not_an_aios_product_root:${root}`);
  }
}

function surfaceSpecs() {
  return [
    {
      id: 'aios_phase8_job_intake',
      label: 'AI OS phase8 job intake normalizer',
      productFile: 'packages/aios-language/runtime/phase8-job-intake.mjs',
      testFile: 'tests/phase8-job-intake.test.mjs',
      exportName: 'normalizeAiosJobIntake',
      stub: `export function normalizeAiosJobIntake(input = {}) {\n  return { ok: false, error: 'pending_phase8_aios_job_intake' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { normalizeAiosJobIntake } from '../packages/aios-language/runtime/phase8-job-intake.mjs';\n\ntest('AI OS phase8 job intake denies external writes and normalizes bounded capability scope', () => {\n  assert.deepEqual(normalizeAiosJobIntake({\n    objective: '  Ship kernel status proof  ',\n    priority: 'HIGH',\n    capabilities: ['fs.read', 'memory.search', 'fs.read', 'external.send'],\n    externalWrites: true\n  }), {\n    ok: true,\n    objective: 'Ship kernel status proof',\n    priority: 'high',\n    capabilities: ['fs.read', 'memory.search'],\n    externalWritesAllowed: false,\n    truthBoundary: 'external_writes_denied_by_default'\n  });\n  assert.deepEqual(normalizeAiosJobIntake({ objective: '   ', capabilities: ['fs.read'] }), {\n    ok: false,\n    error: 'objective_required',\n    capabilities: [],\n    externalWritesAllowed: false\n  });\n});\n`,
      goal: `Implement normalizeAiosJobIntake in packages/aios-language/runtime/phase8-job-intake.mjs so tests/phase8-job-intake.test.mjs passes exactly. It must trim objective, lowercase priority, dedupe capabilities, drop external-send/write capabilities, always deny external writes by default, and return the exact object shapes asserted by the verifier. Add small named helpers or normalization logic; do not only hard-code one literal return.`
    },
    {
      id: 'aios_phase8_capability_digest',
      label: 'AI OS phase8 capability digest',
      productFile: 'packages/aios-language/runtime/phase8-capability-digest.mjs',
      testFile: 'tests/phase8-capability-digest.test.mjs',
      exportName: 'buildCapabilityDigest',
      stub: `export function buildCapabilityDigest(input = {}) {\n  return { ok: false, error: 'pending_phase8_capability_digest' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { buildCapabilityDigest } from '../packages/aios-language/runtime/phase8-capability-digest.mjs';\n\nfunction expectedDigest(owner, caps) {\n  return createHash('sha256').update(JSON.stringify({ owner, caps })).digest('hex').slice(0, 16);\n}\n\ntest('AI OS phase8 capability digest is stable, sorted, scoped, and external-write-safe', () => {\n  const result = buildCapabilityDigest({ owner: 'Jake', capabilities: ['memory.write', 'fs.read', 'fs.read', 'external.send'] });\n  assert.deepEqual(result, {\n    ok: true,\n    owner: 'jake',\n    capabilities: ['fs.read', 'memory.write'],\n    capabilityCount: 2,\n    digest: expectedDigest('jake', ['fs.read', 'memory.write']),\n    externalWriteDenied: true\n  });\n});\n`,
      goal: `Implement buildCapabilityDigest in packages/aios-language/runtime/phase8-capability-digest.mjs so tests/phase8-capability-digest.test.mjs passes exactly. It must lowercase owner, sort/dedupe non-external capabilities, deny external-send/write scope, and compute the deterministic sha256-derived digest used by the verifier. Add small helper functions; do not only return a fixed fixture.`
    },
    {
      id: 'aios_phase8_execution_slot',
      label: 'AI OS phase8 execution slot allocator',
      productFile: 'packages/aios-kernel/scheduler/phase8-execution-slot.mjs',
      testFile: 'tests/phase8-execution-slot.test.mjs',
      exportName: 'allocatePhase8ExecutionSlot',
      stub: `export function allocatePhase8ExecutionSlot(input = {}) {\n  return { ok: false, error: 'pending_phase8_execution_slot' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { allocatePhase8ExecutionSlot } from '../packages/aios-kernel/scheduler/phase8-execution-slot.mjs';\n\ntest('AI OS phase8 execution slot allocator routes bounded work to Hetzner and blocks control-plane heavy work', () => {\n  assert.deepEqual(allocatePhase8ExecutionSlot({ workerId: ' Agent-7 ', requestedPlane: 'remote', estimatedTokens: 48000 }), {\n    ok: true,\n    workerId: 'agent-7',\n    executionPlane: 'hetzner',\n    budgetClass: 'bounded',\n    externalActions: 'denied'\n  });\n  assert.deepEqual(allocatePhase8ExecutionSlot({ workerId: 'agent-8', requestedPlane: 'control_plane', estimatedTokens: 200000 }), {\n    ok: false,\n    blocker: 'heavy_work_requires_execution_plane',\n    workerId: 'agent-8',\n    externalActions: 'denied'\n  });\n});\n`,
      goal: `Implement allocatePhase8ExecutionSlot in packages/aios-kernel/scheduler/phase8-execution-slot.mjs so tests/phase8-execution-slot.test.mjs passes exactly. It must normalize worker IDs, route remote/heavy bounded work to hetzner, deny external actions, and block heavy control-plane placement with the exact blocker shape. Add small decision helpers; do not only hard-code a single return.`
    },
    {
      id: 'aios_phase8_evidence_reducer',
      label: 'AI OS phase8 evidence reducer',
      productFile: 'packages/aios-kernel/verifier-claim-gate/phase8-evidence-reducer.mjs',
      testFile: 'tests/phase8-evidence-reducer.test.mjs',
      exportName: 'reducePhase8Evidence',
      stub: `export function reducePhase8Evidence(input = {}) {\n  return { ok: false, error: 'pending_phase8_evidence_reducer' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { reducePhase8Evidence } from '../packages/aios-kernel/verifier-claim-gate/phase8-evidence-reducer.mjs';\n\ntest('AI OS phase8 evidence reducer separates green workload evidence from release-candidate overclaims', () => {\n  assert.deepEqual(reducePhase8Evidence([{ id: 'boot', status: 'green' }, { id: 'run', ok: true }]), {\n    ok: true,\n    status: 'green',\n    passed: 2,\n    failed: 0,\n    claimAllowed: true,\n    rejectedClaims: ['runtime replacement', 'external writes', 'full parity']\n  });\n  assert.deepEqual(reducePhase8Evidence([{ id: 'boot', status: 'green' }, { id: 'claim', status: 'red' }]), {\n    ok: false,\n    status: 'blocked',\n    passed: 1,\n    failed: 1,\n    claimAllowed: false,\n    rejectedClaims: ['runtime replacement', 'external writes', 'full parity']\n  });\n});\n`,
      goal: `Implement reducePhase8Evidence in packages/aios-kernel/verifier-claim-gate/phase8-evidence-reducer.mjs so tests/phase8-evidence-reducer.test.mjs passes exactly. It must count green/ok checks, block on any red check, allow only bounded green workload claims, and always reject runtime replacement, external writes, and full parity. Add reducer logic; do not only hard-code the asserted arrays.`
    }
  ];
}

const args = parseArgs(process.argv.slice(2));
try {
  ensureAiosRoot(args.aiosRoot);
  const outDir = path.resolve(args.out);
  const aiosRoot = path.resolve(args.aiosRoot);
  const surfaceCount = Math.max(1, Math.min(4, Number(args.surfaceCount || 4)));
  const selectedSurfaces = surfaceSpecs().slice(0, surfaceCount);
  fs.mkdirSync(outDir, { recursive: true });
  for (const surface of selectedSurfaces) {
    write(path.join(aiosRoot, surface.productFile), surface.stub);
    write(path.join(aiosRoot, surface.testFile), surface.test);
  }
  const runId = args.runId || `${args.benchmarkId}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const artifactRoot = path.resolve(args.artifactRoot || path.join(outDir, 'run'));
  const workerCommand = normalizeWorkerCommand(args.workerCommand);
  const surfaces = selectedSurfaces.map((surface) => ({
    id: surface.id,
    label: surface.label,
    goal: surface.goal,
    files: [surface.productFile],
    verify: [`node --test ${surface.testFile}`],
    metadata: {
      workloadClass: 'ai_os_product_platform',
      sourceProject: 'ai-os',
      productFile: surface.productFile,
      testFile: surface.testFile
    }
  }));
  const handoffInput = {
    objective: 'Phase 8 AI OS product-platform workload: drive bounded real model-worker product diffs in the AI OS language/kernel product tree without external actions or release overclaim.',
    goalId: 'agent_work_phase8_ai_os_product_platform_workload',
    repoPath: aiosRoot,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    runId,
    artifactRoot,
    scoreboardPath: path.join(artifactRoot, 'scoreboard.json'),
    fidelity: 'production_slice',
    requestedAgentCount: surfaceCount,
    executionBoundary: args.executionBoundary,
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'external_write', 'touch_prod', 'relaunch_benchmark'] },
    doneWhen: ['all_worker_product_diffs_landed', 'all_verifiers_pass', 'no_truth_layer_overclaim'],
    routeLevels: ['L5 oracle', 'L24 nexus', 'L27 forge', 'L34 validator'],
    wavePolicy: { max_waves: Math.max(1, Number(args.maxWaves || 1)), handoff: 'wave_factpack' },
    expansionPolicy: { triggers: [], max_cycles: 0 },
    surfaces,
    metadata: {
      workloadClass: 'ai_os_product_platform',
      phase8ReleaseCandidateWorkload: true,
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        promptMode: 'compact',
        externalVerification: true,
        workerCommand
      },
      canonicalLandingEvidence: {
        enabled: true,
        minAddedLineCount: 1,
        minUniqueNormalizedAddedLineCount: 1,
        duplicateLineRatioMax: 0.9
      },
      truthBoundary: 'This workload can credit only the Phase 8 AI OS product-platform workload class. It does not prove AI OS runtime replacement, external writes, full parity, 12-worker scale, six-hour soak, or release-candidate green.'
    }
  };
  write(path.join(outDir, 'handoff_input.json'), JSON.stringify(handoffInput, null, 2) + '\n');
  const compiled = writeCortexAgentWorkHandoff({ input: handoffInput, outputDir: path.join(outDir, 'compiled'), options: { runId } });
  const recommendedRuntimeEnv = {
    BENCHMARK_HOST_ROLE: 'execution_plane',
    HOST_ROLE: 'execution_plane',
    PATH_PREFIX: '/home/jake/.local/bin',
    CODEX_BIN: '/home/jake/.local/bin/codex',
    CODEX_CREATIVE_MAX_ITERATIONS: '2',
    CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
    CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
    CREATIVE_WORKER_PROMPT_MODE: 'compact',
    CODEX_CREATIVE_PROMPT_MODE: 'compact',
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: String(surfaceCount),
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: String(surfaceCount * 2),
    CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1'
  };
  write(path.join(outDir, 'aios_workload_meta.json'), JSON.stringify({
    runId,
    outDir,
    aiosRoot,
    repoPath: aiosRoot,
    artifactRoot,
    compiledDir: path.join(outDir, 'compiled'),
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    surfaceCount,
    requestedAgentCount: surfaceCount,
    workerCommand,
    recommendedRuntimeEnv,
    surfaces: selectedSurfaces.map(({ id, productFile, testFile }) => ({ id, productFile, testFile })),
    truthBoundary: handoffInput.metadata.truthBoundary
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    runId,
    outDir,
    aiosRoot,
    repoPath: aiosRoot,
    artifactRoot,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    surfaceCount,
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    productDiffMode: compiled.runContract.scope.productDiffMode,
    executionBoundary: compiled.runContract.executionBoundary
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
}
