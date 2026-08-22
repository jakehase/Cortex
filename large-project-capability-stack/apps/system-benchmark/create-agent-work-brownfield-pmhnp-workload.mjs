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
    repoRoot: null,
    artifactRoot: null,
    runId: null,
    benchmarkId: 'agent_work_brownfield_pmhnp_4agent',
    surfaceCount: 4,
    workerCommand: null,
    executionBoundary: 'remote_execution_required',
    maxWaves: 1
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--repo' || token === '--repo-path' || token === '--pmhnp-root') { args.repoRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || '').trim(); index += 1; continue; }
    if (token === '--benchmark-id') { args.benchmarkId = String(next || '').trim(); index += 1; continue; }
    if (token === '--surface-count' || token === '--surfaces' || token === '--agents' || token === '--agent-count') { args.surfaceCount = Number(next); index += 1; continue; }
    if (token === '--worker-command') { args.workerCommand = String(next || '').trim(); index += 1; continue; }
    if (token === '--execution-boundary') { args.executionBoundary = String(next || '').trim(); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
  }
  if (!args.out || !args.repoRoot) {
    console.error('usage: node apps/system-benchmark/create-agent-work-brownfield-pmhnp-workload.mjs --out <artifact-dir> --repo <pmhnp-code-only-repo> [--artifact-root <controller-run-root>] [--run-id <id>]');
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

function ensurePmhnpRoot(root) {
  const packagePath = path.join(root, 'package.json');
  const serverPath = path.join(root, 'src/ops/operationalHttpServerCli.mjs');
  const pkg = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, 'utf8')) : null;
  if (!pkg || !fs.existsSync(serverPath) || !String(pkg.name || '').includes('pmhnp')) {
    throw new Error(`not_pmhnp_code_root:${root}`);
  }
}

function surfaceSpecs() {
  return [
    {
      id: 'pmhnp_phase8_claim_risk_normalizer',
      label: 'PMHNP phase8 claim risk normalizer',
      productFile: 'src/domain/phase8ClaimRiskNormalizer.mjs',
      testFile: 'tests/phase8-claim-risk-normalizer.test.mjs',
      stub: `export function normalizeClaimRiskRecord(input = {}) {\n  return { ok: false, error: 'pending_phase8_claim_risk_normalizer' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { normalizeClaimRiskRecord } from '../src/domain/phase8ClaimRiskNormalizer.mjs';\n\ntest('normalizes synthetic PMHNP claim-risk records without client data', () => {\n  assert.deepEqual(normalizeClaimRiskRecord({\n    claimRef: ' CLAIM-42 ',\n    denialCode: ' co-197 ',\n    payer: ' Example Health ',\n    dollarsAtRisk: '125.505',\n    tags: [' auth ', 'AUTH', '', ' telehealth ']\n  }), {\n    ok: true,\n    claim_ref: 'CLAIM-42',\n    denial_code: 'CO-197',\n    payer: 'Example Health',\n    dollars_at_risk: 125.51,\n    tags: ['auth', 'telehealth'],\n    phi: false\n  });\n  assert.deepEqual(normalizeClaimRiskRecord({ claimRef: ' ', dollarsAtRisk: 'bad' }), {\n    ok: false,\n    error: 'claim_ref_required',\n    phi: false\n  });\n});\n`,
      goal: 'Implement normalizeClaimRiskRecord in src/domain/phase8ClaimRiskNormalizer.mjs so tests/phase8-claim-risk-normalizer.test.mjs passes exactly. Use synthetic/code-only logic only: trim and normalize claim refs, denial codes, payer, dollars, and deduped lowercase tags; never introduce real client/patient data; always mark phi false. Add small helpers rather than returning a one-off literal.'
    },
    {
      id: 'pmhnp_phase8_appeal_checklist',
      label: 'PMHNP phase8 appeal checklist builder',
      productFile: 'src/domain/phase8AppealChecklist.mjs',
      testFile: 'tests/phase8-appeal-checklist.test.mjs',
      stub: `export function buildAppealChecklist(input = {}) {\n  return { ok: false, error: 'pending_phase8_appeal_checklist' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { buildAppealChecklist } from '../src/domain/phase8AppealChecklist.mjs';\n\ntest('builds payer-safe synthetic appeal checklist by denial family', () => {\n  assert.deepEqual(buildAppealChecklist({ denialCode: 'auth-pa-missing', urgency: 'critical', evidence: [' Auth Letter ', 'visit note', 'auth letter'] }), {\n    ok: true,\n    denial_code: 'AUTH-PA-MISSING',\n    urgency: 'critical',\n    required_items: ['authorization reference', 'service date range', 'rendering provider match', 'visit note'],\n    supplied_evidence: ['Auth Letter', 'visit note'],\n    missing_items: ['authorization reference', 'service date range', 'rendering provider match'],\n    external_actions: 'denied'\n  });\n  assert.equal(buildAppealChecklist({ denialCode: 'unknown' }).ok, false);\n});\n`,
      goal: 'Implement buildAppealChecklist in src/domain/phase8AppealChecklist.mjs so tests/phase8-appeal-checklist.test.mjs passes exactly. Map AUTH-PA-MISSING to a PMHNP-safe synthetic checklist, normalize supplied evidence, compute missing items, deny external actions, and return a blocked shape for unknown denial codes. Do not add real patient/client data.'
    },
    {
      id: 'pmhnp_phase8_roi_triage',
      label: 'PMHNP phase8 ROI triage reducer',
      productFile: 'src/domain/phase8RoiTriage.mjs',
      testFile: 'tests/phase8-roi-triage.test.mjs',
      stub: `export function reduceRoiTriage(input = {}) {\n  return { ok: false, error: 'pending_phase8_roi_triage' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { reduceRoiTriage } from '../src/domain/phase8RoiTriage.mjs';\n\ntest('reduces synthetic PMHNP ROI triage events into an honest pilot signal', () => {\n  assert.deepEqual(reduceRoiTriage([\n    { category: 'appeal', dollarsRecovered: '200', staffMinutesSaved: 15 },\n    { category: 'prevention', dollarsProtected: 125.125, staffMinutesSaved: 30 },\n    { category: 'appeal', dollarsRecovered: -20, staffMinutesSaved: 'bad' }\n  ]), {\n    ok: true,\n    event_count: 3,\n    dollars_recovered: 200,\n    dollars_protected: 125.13,\n    staff_minutes_saved: 45,\n    estimated_total_impact: 346.13,\n    evidence_strength: 'early-signal',\n    truth_boundary: 'synthetic_pilot_signal_not_payer_remittance'\n  });\n});\n`,
      goal: 'Implement reduceRoiTriage in src/domain/phase8RoiTriage.mjs so tests/phase8-roi-triage.test.mjs passes exactly. Sum non-negative synthetic recovered/protected dollars and staff minutes, compute staff savings at $28/hour, round money to cents, label evidence strength honestly, and include the truth boundary. Do not add payer remittance/client claims.'
    },
    {
      id: 'pmhnp_phase8_export_guard',
      label: 'PMHNP phase8 export upload guard',
      productFile: 'src/domain/phase8ExportGuard.mjs',
      testFile: 'tests/phase8-export-guard.test.mjs',
      stub: `export function guardExportUpload(input = {}) {\n  return { ok: false, error: 'pending_phase8_export_guard' };\n}\n`,
      test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { guardExportUpload } from '../src/domain/phase8ExportGuard.mjs';\n\ntest('guards export-upload metadata without accepting PHI-like payloads', () => {\n  assert.deepEqual(guardExportUpload({ fileName: ' tebra-denials.csv ', mimeType: 'text/csv', rowCount: 12, containsPhi: false }), {\n    ok: true,\n    file_name: 'tebra-denials.csv',\n    mime_type: 'text/csv',\n    row_count: 12,\n    route: 'manual_review_queue',\n    external_write_allowed: false\n  });\n  assert.deepEqual(guardExportUpload({ fileName: 'patients.csv', mimeType: 'text/csv', rowCount: 3, containsPhi: true }), {\n    ok: false,\n    error: 'phi_payload_rejected',\n    external_write_allowed: false\n  });\n  assert.equal(guardExportUpload({ fileName: 'bad.exe', mimeType: 'application/octet-stream' }).ok, false);\n});\n`,
      goal: 'Implement guardExportUpload in src/domain/phase8ExportGuard.mjs so tests/phase8-export-guard.test.mjs passes exactly. Accept only safe CSV metadata with no PHI flag, reject PHI-like payloads and unsafe types, route safe uploads to manual_review_queue, and always keep external_write_allowed false.'
    }
  ];
}

const args = parseArgs(process.argv.slice(2));
try {
  ensurePmhnpRoot(args.repoRoot);
  const outDir = path.resolve(args.out);
  const repoRoot = path.resolve(args.repoRoot);
  const surfaceCount = Math.max(1, Math.min(4, Number(args.surfaceCount || 4)));
  const selectedSurfaces = surfaceSpecs().slice(0, surfaceCount);
  fs.mkdirSync(outDir, { recursive: true });
  for (const surface of selectedSurfaces) {
    write(path.join(repoRoot, surface.productFile), surface.stub);
    write(path.join(repoRoot, surface.testFile), surface.test);
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
      workloadClass: 'brownfield_transfer',
      sourceProject: 'pmhnp-denial-copilot',
      productFile: surface.productFile,
      testFile: surface.testFile,
      clientDataAllowed: false
    }
  }));
  const handoffInput = {
    objective: 'Phase 8 brownfield transfer workload: drive bounded real model-worker product diffs in the PMHNP Claim Guard code-only repo without client data or external actions.',
    goalId: 'agent_work_phase8_brownfield_pmhnp_workload',
    repoPath: repoRoot,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    runId,
    artifactRoot,
    scoreboardPath: path.join(artifactRoot, 'scoreboard.json'),
    fidelity: 'production_slice',
    requestedAgentCount: surfaceCount,
    executionBoundary: args.executionBoundary,
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'external_write', 'touch_prod', 'client_data', 'phi'] },
    doneWhen: ['all_worker_product_diffs_landed', 'all_verifiers_pass', 'no_truth_layer_overclaim', 'no_client_data_in_worker_context'],
    routeLevels: ['L5 oracle', 'L24 nexus', 'L27 forge', 'L34 validator'],
    wavePolicy: { max_waves: Math.max(1, Number(args.maxWaves || 1)), handoff: 'wave_factpack' },
    expansionPolicy: { triggers: [], max_cycles: 0 },
    surfaces,
    metadata: {
      workloadClass: 'brownfield_transfer',
      phase8ReleaseCandidateWorkload: true,
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      clientDataPolicy: { allowed: false, syncedStateDir: false, syncedRecoveryProbes: false, syntheticFixturesOnly: true },
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
      truthBoundary: 'This workload can credit only the Phase 8 brownfield_transfer workload class on a PMHNP code-only repo copy. It does not prove 12-worker scale, six-hour soak, Mailchimp clone parity, production deployment, external writes, or release-candidate green.'
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
  write(path.join(outDir, 'brownfield_workload_meta.json'), JSON.stringify({
    runId,
    outDir,
    repoRoot,
    repoPath: repoRoot,
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
    clientDataPolicy: handoffInput.metadata.clientDataPolicy,
    truthBoundary: handoffInput.metadata.truthBoundary
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    runId,
    outDir,
    repoRoot,
    repoPath: repoRoot,
    artifactRoot,
    benchmarkId: args.benchmarkId,
    benchmarkTier: 'real_worker_product_standard',
    surfaceCount,
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
