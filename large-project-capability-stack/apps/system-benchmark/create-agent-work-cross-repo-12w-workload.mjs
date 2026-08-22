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
    workspaceRoot: null,
    artifactRoot: null,
    runId: null,
    benchmarkId: 'agent_work_phase8_cross_repo_12agent',
    workerCommand: null,
    executionBoundary: 'remote_execution_required',
    maxWaves: 1
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--workspace-root' || token === '--repo' || token === '--repo-path') { args.workspaceRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || '').trim(); index += 1; continue; }
    if (token === '--benchmark-id') { args.benchmarkId = String(next || '').trim(); index += 1; continue; }
    if (token === '--worker-command') { args.workerCommand = String(next || '').trim(); index += 1; continue; }
    if (token === '--execution-boundary') { args.executionBoundary = String(next || '').trim(); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
  }
  if (!args.out || !args.workspaceRoot) {
    console.error('usage: node apps/system-benchmark/create-agent-work-cross-repo-12w-workload.mjs --out <artifact-dir> --workspace-root <aggregate-workspace> [--artifact-root <controller-run-root>] [--run-id <id>]');
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

function ensureAggregateRoot(root) {
  const required = [
    'large-project-capability-stack/package.json',
    'ai-os/package.json',
    'pmhnp-denial-copilot/package.json'
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
  if (missing.length) throw new Error(`aggregate_workspace_missing:${missing.join(',')}`);
}

function sharedSurface(index) {
  const suffix = String(index).padStart(2, '0');
  const fn = `reducePhase8CrossRepoShared${suffix}`;
  const productFile = `large-project-capability-stack/packages/agent-work-release-candidate/cross-repo/shared-${suffix}.mjs`;
  const testFile = `large-project-capability-stack/tests/phase8-crossrepo-shared-${suffix}.test.mjs`;
  const expectedKind = `shared-cross-repo-${suffix}`;
  return {
    id: `cross_repo_shared_${suffix}`,
    label: `Shared stack cross-repo scale surface ${suffix}`,
    productFile,
    testFile,
    stub: `export function ${fn}(input = {}) {\n  return { ok: false, error: 'pending_cross_repo_shared_${suffix}' };\n}\n`,
    test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../packages/agent-work-release-candidate/cross-repo/shared-${suffix}.mjs';\n\ntest('shared stack cross-repo scale surface ${suffix}', () => {\n  assert.deepEqual(${fn}({ claim: ' phase8 ', workers: ${index}, external: true }), {\n    ok: true,\n    kind: '${expectedKind}',\n    claim: 'phase8',\n    workerSlot: ${index},\n    externalActions: 'denied',\n    releaseCandidate: false\n  });\n});\n`,
    goal: `Implement ${fn} in ${productFile} so ${testFile} passes exactly. Normalize the claim, preserve workerSlot ${index}, always deny external actions, and keep releaseCandidate false. Add a small helper/builder; do not hard-code a single opaque literal.`
  };
}

function aiosSurface(index) {
  const suffix = String(index).padStart(2, '0');
  const slot = index + 4;
  const fn = `buildCrossRepoAiosPacket${suffix}`;
  const productFile = `ai-os/packages/aios-language/runtime/phase8-crossrepo-aios-${suffix}.mjs`;
  const testFile = `ai-os/tests/phase8-crossrepo-aios-${suffix}.test.mjs`;
  return {
    id: `cross_repo_aios_${suffix}`,
    label: `AI OS cross-repo scale surface ${suffix}`,
    productFile,
    testFile,
    stub: `export function ${fn}(input = {}) {\n  return { ok: false, error: 'pending_cross_repo_aios_${suffix}' };\n}\n`,
    test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../packages/aios-language/runtime/phase8-crossrepo-aios-${suffix}.mjs';\n\ntest('AI OS cross-repo scale surface ${suffix}', () => {\n  assert.deepEqual(${fn}({ process: ' worker-${slot} ', capability: ['fs.read', 'external.send', 'memory.search', 'fs.read'] }), {\n    ok: true,\n    processId: 'worker-${slot}',\n    capabilities: ['fs.read', 'memory.search'],\n    slot: ${slot},\n    runtimeReplacement: false,\n    externalWritesAllowed: false\n  });\n});\n`,
    goal: `Implement ${fn} in ${productFile} so ${testFile} passes exactly. Normalize the process id, dedupe/sort capabilities, drop external-send/write capabilities, set slot ${slot}, and explicitly keep runtimeReplacement/externalWritesAllowed false. Add clear normalizer logic; do not include external write capability.`
  };
}

function pmhnpSurface(index) {
  const suffix = String(index).padStart(2, '0');
  const slot = index + 8;
  const fn = `buildCrossRepoPmhnpSignal${suffix}`;
  const productFile = `pmhnp-denial-copilot/src/domain/phase8CrossRepoSignal${suffix}.mjs`;
  const testFile = `pmhnp-denial-copilot/tests/phase8-crossrepo-pmhnp-${suffix}.test.mjs`;
  return {
    id: `cross_repo_pmhnp_${suffix}`,
    label: `PMHNP cross-repo scale surface ${suffix}`,
    productFile,
    testFile,
    stub: `export function ${fn}(input = {}) {\n  return { ok: false, error: 'pending_cross_repo_pmhnp_${suffix}' };\n}\n`,
    test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../src/domain/phase8CrossRepoSignal${suffix}.mjs';\n\ntest('PMHNP cross-repo code-only signal ${suffix}', () => {\n  assert.deepEqual(${fn}({ claimRef: ' PMHNP-${slot} ', family: ' auth ', dollars: '42.425', containsPhi: false }), {\n    ok: true,\n    claim_ref: 'PMHNP-${slot}',\n    family: 'auth',\n    dollars_at_risk: 42.43,\n    slot: ${slot},\n    phi: false,\n    external_write_allowed: false\n  });\n  assert.deepEqual(${fn}({ claimRef: 'bad', containsPhi: true }), { ok: false, error: 'phi_payload_rejected', external_write_allowed: false });\n});\n`,
    goal: `Implement ${fn} in ${productFile} so ${testFile} passes exactly. Use synthetic code-only PMHNP logic: normalize claim refs/family/dollars, set slot ${slot}, reject PHI-flagged payloads, and always keep external_write_allowed false. Do not add real client or patient data.`
  };
}

function surfaceSpecs() {
  return [1, 2, 3, 4].map(sharedSurface)
    .concat([1, 2, 3, 4].map(aiosSurface))
    .concat([1, 2, 3, 4].map(pmhnpSurface));
}

const args = parseArgs(process.argv.slice(2));
try {
  ensureAggregateRoot(args.workspaceRoot);
  const outDir = path.resolve(args.out);
  const workspaceRoot = path.resolve(args.workspaceRoot);
  const selectedSurfaces = surfaceSpecs();
  fs.mkdirSync(outDir, { recursive: true });
  for (const surface of selectedSurfaces) {
    write(path.join(workspaceRoot, surface.productFile), surface.stub);
    write(path.join(workspaceRoot, surface.testFile), surface.test);
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
      phase8CrossRepoScale: true,
      sourceProject: surface.productFile.split('/')[0],
      productFile: surface.productFile,
      testFile: surface.testFile,
      clientDataAllowed: false
    }
  }));
  const handoffInput = {
    objective: 'Phase 8 12-worker productive cross-repo campaign: drive real model-worker product diffs across shared stack, AI OS, and PMHNP code-only surfaces without external actions.',
    goalId: 'agent_work_phase8_cross_repo_12worker_campaign',
    repoPath: workspaceRoot,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    runId,
    artifactRoot,
    scoreboardPath: path.join(artifactRoot, 'scoreboard.json'),
    fidelity: 'production_slice',
    requestedAgentCount: 12,
    executionBoundary: args.executionBoundary,
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'external_write', 'touch_prod', 'client_data', 'phi'] },
    doneWhen: ['all_worker_product_diffs_landed', 'all_verifiers_pass', 'observed_12_physical_workers', 'no_truth_layer_overclaim'],
    routeLevels: ['L5 oracle', 'L24 nexus', 'L27 forge', 'L34 validator'],
    wavePolicy: { max_waves: Math.max(1, Number(args.maxWaves || 1)), handoff: 'wave_factpack' },
    expansionPolicy: { triggers: [], max_cycles: 0 },
    surfaces,
    metadata: {
      phase8CrossRepoScaleCampaign: true,
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      crossRepoWorkerTarget: 12,
      projectDistribution: { shared_stack: 4, ai_os: 4, pmhnp_brownfield_code_only: 4 },
      clientDataPolicy: { allowed: false, syncedPmhnpStateDir: false, syncedRecoveryProbes: false, syntheticFixturesOnly: true },
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
      truthBoundary: 'This workload can credit the Phase 8 12-worker productive cross-repo campaign only if 12 observed model workers produce verified product diffs. It does not prove six-hour soak, independent review, full parity, production deployment, external writes, or release-candidate green by itself.'
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
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '12',
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '24',
    CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1'
  };
  write(path.join(outDir, 'cross_repo_12w_meta.json'), JSON.stringify({
    runId,
    outDir,
    workspaceRoot,
    repoPath: workspaceRoot,
    artifactRoot,
    compiledDir: path.join(outDir, 'compiled'),
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    surfaceCount: selectedSurfaces.length,
    requestedAgentCount: 12,
    workerCommand,
    recommendedRuntimeEnv,
    surfaces: selectedSurfaces.map(({ id, productFile, testFile }) => ({ id, productFile, testFile })),
    clientDataPolicy: handoffInput.metadata.clientDataPolicy,
    truthBoundary: handoffInput.metadata.truthBoundary
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    runId,
    outDir,
    workspaceRoot,
    repoPath: workspaceRoot,
    artifactRoot,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    surfaceCount: selectedSurfaces.length,
    requestedAgentCount: 12,
    runContractPath: compiled.files.runContractPath,
    cortexHandoffPath: compiled.files.cortexHandoffPath,
    productDiffMode: compiled.runContract.scope.productDiffMode,
    executionBoundary: compiled.runContract.executionBoundary,
    clientDataAllowed: false
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
}
