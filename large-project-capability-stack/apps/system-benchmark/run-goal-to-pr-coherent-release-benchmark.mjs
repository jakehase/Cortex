#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProductionQualityRepairSurfaces } from '../../packages/continuous-workload-controller/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const COMPILE_CORTEX_AGENT_WORK = path.join(SCRIPT_DIR, 'compile-cortex-agent-work.mjs');
const OBJECTIVE_CONTROLLER = path.join(SCRIPT_DIR, 'run-agent-work-objective-controller.mjs');
const QUALITY_GATE = path.join(SCRIPT_DIR, 'evaluate-production-quality-gate.mjs');
const ROUTE_COLLISION_CHECK = path.join(SCRIPT_DIR, 'check-route-collisions.mjs');
const DEFAULT_SOURCE_REPO = '/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/mailchimp_100agent_creative_product_240m_continuous_endurance/creative-real-claim-gated-continuous240-100agent-4h-20260614T082511Z/repo';

function nowIso() { return new Date().toISOString(); }
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(targetPath, fallback = null) {
  try { return fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : fallback; } catch { return fallback; }
}
function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || STACK_ROOT,
    env: options.env || process.env,
    shell: options.shell === true,
    encoding: 'utf8',
    timeout: options.timeoutMs || undefined,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024
  });
  return {
    command: options.shell === true ? command : [command, ...args].join(' '),
    cwd: options.cwd || STACK_ROOT,
    exitCode: result.status,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: result.status === 0
  };
}
function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).flatMap((entry) => {
    if (Array.isArray(entry)) return entry;
    return String(entry ?? '').split(/,|\n/);
  }).map((entry) => String(entry || '').trim()).filter(Boolean))];
}
function runLogged(command, args, { cwd, env, stdoutPath, stderrPath, timeoutMs } = {}) {
  const result = run(command, args, { cwd, env, timeoutMs, maxBuffer: 128 * 1024 * 1024 });
  if (stdoutPath) { fs.mkdirSync(path.dirname(stdoutPath), { recursive: true }); fs.writeFileSync(stdoutPath, result.stdout); }
  if (stderrPath) { fs.mkdirSync(path.dirname(stderrPath), { recursive: true }); fs.writeFileSync(stderrPath, result.stderr); }
  return result;
}
function parseArgs(argv) {
  const args = {
    sourceRepo: process.env.GOAL_TO_PR_SOURCE_REPO || DEFAULT_SOURCE_REPO,
    artifactRoot: null,
    runId: null,
    requestedAgents: 10,
    maxWaves: 3,
    maxQualityRepairCycles: Number(process.env.GOAL_TO_PR_MAX_QUALITY_REPAIR_CYCLES || 0),
    minMergedShards: Number(process.env.GOAL_TO_PR_MIN_MERGED_SHARDS || 1),
    testCommand: 'npm test',
    dryRun: false,
    skipBaselineTests: false,
    keepExisting: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]; const next = argv[i + 1];
    if (token === '--source-repo') { args.sourceRepo = path.resolve(next); i += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); i += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || ''); i += 1; continue; }
    if (token === '--requested-agents') { args.requestedAgents = Number(next); i += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); i += 1; continue; }
    if (token === '--max-quality-repair-cycles') { args.maxQualityRepairCycles = Number(next); i += 1; continue; }
    if (token === '--min-merged-shards') { args.minMergedShards = Number(next); i += 1; continue; }
    if (token === '--test-command') { args.testCommand = String(next || 'npm test'); i += 1; continue; }
    if (token === '--skip-baseline-tests') { args.skipBaselineTests = true; continue; }
    if (token === '--keep-existing') { args.keepExisting = true; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
  }
  const runStamp = stamp();
  args.runId ||= `goal-to-pr-coherent-release-${runStamp}`;
  args.artifactRoot ||= path.join(STACK_ROOT, 'artifacts', 'benchmarks', 'goal_to_pr_coherent_release', args.runId);
  args.requestedAgents = Math.max(1, Math.min(20, Number(args.requestedAgents || 10)));
  args.maxWaves = Math.max(1, Number(args.maxWaves || 3));
  args.maxQualityRepairCycles = Math.max(0, Number(args.maxQualityRepairCycles || Math.max(1, args.maxWaves - 1)));
  args.minMergedShards = Math.max(1, Number(args.minMergedShards || 1));
  return args;
}
function ensureFreshDir(dir, keepExisting = false) {
  if (fs.existsSync(dir) && !keepExisting) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function rsyncCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const result = run('rsync', ['-a', '--delete', `${src.replace(/\/$/, '')}/`, `${dest.replace(/\/$/, '')}/`], { timeoutMs: 30 * 60 * 1000 });
  if (!result.ok) throw new Error(`rsync failed from ${src} to ${dest}: ${result.stderr || result.stdout}`);
  return result;
}
function commitBaseline(repoPath) {
  run('git', ['config', 'user.email', 'benchmark@openclaw.local'], { cwd: repoPath });
  run('git', ['config', 'user.name', 'OpenClaw Benchmark'], { cwd: repoPath });
  run('git', ['add', '-A'], { cwd: repoPath, timeoutMs: 10 * 60 * 1000 });
  const commit = run('git', ['commit', '--allow-empty', '-m', 'benchmark baseline: goal-to-pr coherent release'], { cwd: repoPath, timeoutMs: 10 * 60 * 1000 });
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  return { commit, head: head.stdout.trim() };
}
function productDiffFiles(repoPath) {
  const diff = run('git', ['diff', '--name-only', 'HEAD', '--', 'apps', 'packages', 'src', 'tests'], { cwd: repoPath });
  return diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}
function writeAcceptanceCriteria(root, args) {
  const text = `# Goal-to-PR coherent release acceptance criteria\n\nRun id: ${args.runId}\n\nObjective: repair the post-run Mailchimp 100-agent artifact into a coherent release candidate for the duplicated route surfaces.\n\nRequired green gates:\n\n1. Duplicate route collisions are removed for changed route surfaces, especially:\n   - GET /api/approvals\n   - GET /api/deliverability/runtime\n2. Final integrated product diff exists and touches product code, not only docs/tests.\n3. Full suite is run and recorded. If the baseline is already red, final failures must not regress relative to baseline.\n4. Final route duplicate audit reports zero route collisions.\n5. Bloat guard passes: duplicate normalized line ratio <= 0.18 for final quality evaluation when evidence is available.\n6. Review packet, final diff, quality gate, route audit, completion summary, and threshold evaluation are written.\n\nTruth boundary: this benchmark does not claim full Mailchimp clone parity and does not claim 100-agent scale proof. It tests coherent goal-to-PR integration quality at ${args.requestedAgents} requested agents.\n`;
  fs.writeFileSync(path.join(root, 'acceptance_criteria.md'), text);
}
function surface(id, label, goal, files, verify, options = {}) {
  const { metadata = {}, deps = [], lane = undefined, domain = undefined } = options || {};
  return { id, label, goal, files, verify, deps, lane, domain, metadata };
}
function routeGateCommand({ route = null, out = 'coherent-release-surface-route-audit', requirePresent = false } = {}) {
  const routeArg = route ? ` --route ${JSON.stringify(route)}` : '';
  const presentArg = route && requirePresent ? ' --require-routes-present' : '';
  return `node ${ROUTE_COLLISION_CHECK} --repo-path .${routeArg}${presentArg} --max-route-collisions 0 --out artifacts/${out}.json`;
}
function normalizeGoalRepairSurfaces(rawSurfaces = []) {
  return rawSurfaces.map((surface, index) => {
    const targetFiles = stableList(surface.targetFiles || surface.productFiles || surface.allowedFiles);
    const syntaxChecks = targetFiles
      .filter((file) => /\.(?:mjs|js|jsx|ts|tsx)$/.test(file))
      .map((file) => `node --check ${file}`);
    const verification = stableList([
      ...(surface.verification || []).map((command) => String(command || '').includes('apps/system-benchmark/evaluate-production-quality-gate.mjs')
        ? routeGateCommand({ out: `production-quality-repair-${index + 1}-route-audit` })
        : command),
      ...syntaxChecks
    ]);
    return {
      ...surface,
      targetFiles,
      productFiles: targetFiles,
      allowedFiles: targetFiles,
      files: targetFiles,
      verify: verification,
      verification,
      metadata: {
        ...(surface.metadata || {}),
        goalToPrAutonomousQualityRepair: true,
        productDiffMode: 'creative_product_work',
        creativeProductWorkRequired: true,
        creativeProductWork: {
          ...(surface.metadata?.creativeProductWork || {}),
          required: true,
          workerCommand: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs',
          promptMode: 'compact',
          minIterations: 1,
          minWorkerRuntimeMs: 0,
          compactDensityTarget: 12
        },
        absoluteRouteAuditCommandInjected: verification.some((command) => String(command).includes(ROUTE_COLLISION_CHECK))
      }
    };
  });
}
function makeHandoff(args, repoPath) {
  const globalRouteCollisionGate = routeGateCommand({ out: 'coherent-release-global-route-audit' });
  const approvalRouteGate = routeGateCommand({ route: 'GET /api/approvals', out: 'coherent-release-approvals-route-audit', requirePresent: true });
  const deliverabilityRouteGate = routeGateCommand({ route: 'GET /api/deliverability/runtime', out: 'coherent-release-deliverability-route-audit', requirePresent: true });
  const routeFilesCheck = 'node --check packages/app/routes/api-admin.mjs packages/app/routes/collaboration-approval.mjs packages/app/routes/deliverability-compliance.mjs';
  const surfaces = [
    surface(
      'approvals_api_admin_route_ownership',
      'Approvals admin route ownership',
      'Surgical route-ownership repair only: stop api-admin from registering duplicate GET /api/approvals while preserving admin approval visibility through a non-colliding admin-scoped route if needed. Prefer editing only the duplicate route block; do not rewrite approval payloads or add broad helper scaffolding.',
      ['packages/app/routes/api-admin.mjs'],
      ['node --check packages/app/routes/api-admin.mjs', approvalRouteGate]
    ),
    surface(
      'deliverability_api_admin_route_ownership',
      'Deliverability admin route ownership',
      'Surgical route-ownership repair only: stop api-admin from registering duplicate GET /api/deliverability/runtime while preserving admin deliverability visibility through a non-colliding admin-scoped route if needed. Run after the approvals api-admin route ownership repair so both edits land against the same evolving api-admin file instead of racing into a non-additive conflict.',
      ['packages/app/routes/api-admin.mjs'],
      ['node --check packages/app/routes/api-admin.mjs', deliverabilityRouteGate],
      { deps: ['approvals_api_admin_route_ownership'] }
    ),
    surface(
      'approvals_collaboration_route_contract',
      'Collaboration approvals route contract',
      'Keep the collaboration approval API behavior canonical for GET /api/approvals with the smallest product-code hardening needed. Avoid duplicate aliases, wrappers, or payload expansion unless required by existing code.',
      ['packages/app/routes/collaboration-approval.mjs', 'packages/app/domain-collaboration-approval.mjs'],
      ['node --check packages/app/routes/collaboration-approval.mjs packages/app/domain-collaboration-approval.mjs']
    ),
    surface(
      'deliverability_compliance_runtime_contract',
      'Deliverability compliance runtime contract',
      'Keep the deliverability compliance runtime API behavior canonical for GET /api/deliverability/runtime with the smallest product-code hardening needed. Avoid duplicate aliases, wrappers, or payload expansion unless required by existing code.',
      ['packages/app/routes/deliverability-compliance.mjs', 'packages/app/domain-deliverability-compliance.mjs'],
      ['node --check packages/app/routes/deliverability-compliance.mjs packages/app/domain-deliverability-compliance.mjs']
    ),
    surface(
      'router_registration_coherence',
      'Router registration coherence',
      'Make one small product-code hardening in router registration/error reporting so duplicate route ownership stays visible without hiding literal route registrations from the audit.',
      ['packages/app/router.mjs'],
      ['node --check packages/app/router.mjs']
    ),
    surface(
      'approval_route_response_minimal_hardening',
      'Approval route response minimal hardening',
      'Make a small approval-route runtime-contract improvement tied to the de-duplicated approval API. Keep it under the existing approval route/domain files; no broad response reshaping.',
      ['packages/app/routes/collaboration-approval.mjs', 'packages/app/domain-collaboration-approval.mjs'],
      ['node --check packages/app/routes/collaboration-approval.mjs packages/app/domain-collaboration-approval.mjs']
    ),
    surface(
      'deliverability_runtime_response_minimal_hardening',
      'Deliverability runtime response minimal hardening',
      'Make a small deliverability-runtime contract improvement tied to the de-duplicated runtime API. Keep it under the existing deliverability route/domain files; no broad response reshaping.',
      ['packages/app/routes/deliverability-compliance.mjs', 'packages/app/domain-deliverability-compliance.mjs'],
      ['node --check packages/app/routes/deliverability-compliance.mjs packages/app/domain-deliverability-compliance.mjs']
    ),
    surface(
      'approval_deliverability_integration_hardening',
      'Approval/deliverability integration hardening',
      'Make one compact integration hardening across approval or deliverability route ownership; avoid touching both domains unless necessary and avoid generated/duplicated helpers.',
      ['packages/app/routes/collaboration-approval.mjs', 'packages/app/routes/deliverability-compliance.mjs'],
      [routeFilesCheck]
    ),
    surface(
      'release_candidate_diff_hygiene',
      'Release candidate diff hygiene',
      'Keep the final repair small and coherent: reduce duplicate helper/payload code, avoid generated bloat, and keep route registrations literal enough for the audit to inspect.',
      ['packages/app/routes/api-admin.mjs', 'packages/app/routes/collaboration-approval.mjs', 'packages/app/routes/deliverability-compliance.mjs'],
      ['git diff --check', routeFilesCheck]
    ),
    surface(
      'objective_final_quality_readiness',
      'Objective final quality readiness',
      'Prepare the integrated route repair for final benchmark quality after both api-admin duplicate-route repairs have landed: global route collisions must be zero, syntax must pass, and the diff must remain compact enough for the duplicate-line bloat guard.',
      ['packages/app/routes/api-admin.mjs', 'packages/app/routes/collaboration-approval.mjs', 'packages/app/routes/deliverability-compliance.mjs', 'packages/app/router.mjs'],
      ['git diff --check', 'node --check packages/app/routes/api-admin.mjs packages/app/routes/collaboration-approval.mjs packages/app/routes/deliverability-compliance.mjs packages/app/router.mjs', globalRouteCollisionGate],
      { deps: ['approvals_api_admin_route_ownership', 'deliverability_api_admin_route_ownership'] }
    )
  ].slice(0, args.requestedAgents);
  return {
    schemaVersion: 'cortex.agent_work_handoff.v0',
    generatedAt: nowIso(),
    source: 'openclaw-goal-to-pr-coherent-release-harness',
    owner: 'Jake',
    goalId: 'goal_to_pr_coherent_release',
    objective: 'Repair the post-run Mailchimp artifact into a coherent release candidate by eliminating duplicate approval/deliverability route collisions, preserving API behavior, avoiding objective-caused test regressions, keeping the diff compact, and producing an integrated reviewable final diff.',
    repoPath,
    benchmarkId: 'goal_to_pr_coherent_release',
    benchmarkTier: 'execution_smoke',
    runId: args.runId,
    artifactRoot: path.join(args.artifactRoot, 'compiled-agent-work'),
    fidelity: 'production_slice',
    requestedAgentCount: surfaces.length,
    executionBoundary: 'execution_plane_required',
    stopCondition: 'objective_green_with_quality_gates_or_blocker_report',
    permissions: { allow: ['read_repo', 'edit_product_code', 'run_tests'], forbid: ['external_send', 'deploy_prod', 'touch_prod', 'relaunch_benchmark'] },
    requestedActions: ['decompose', 'implement', 'integrate', 'verify', 'repair', 'package_review_packet'],
    doneWhen: ['global_route_collision_count == 0', 'final_diff_exists', 'full_suite_recorded', 'test_failure_regression_count == 0', 'duplicate_normalized_line_ratio <= 0.18', 'review_packet_complete'],
    budgets: { token_cap: 1800000, worker_prompt_tokens: 12000 },
    wavePolicy: { max_waves: args.maxWaves, full_context_waves: 0 },
    expansionPolicy: { triggers: ['objective_red', 'graph_exhausted'], max_cycles: Math.max(0, args.maxWaves - 1), max_surfaces: Math.max(surfaces.length, args.requestedAgents) },
    evidenceSchemas: [],
    routeLevels: ['L5 oracle', 'L7 librarian', 'L22 mnemosyne', 'L27 forge'],
    surfaces,
    metadata: {
      benchmarkSpec: 'goal_to_pr_coherent_release_benchmark_spec_20260615T0031CDT.md',
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      creativeProductWork: {
        required: true,
        workerCommand: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs',
        promptMode: 'compact',
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        compactDensityTarget: 12
      },
      routeVerifierMode: 'scoped_per_shard_global_final',
      truthBoundary: 'Coherent release benchmark only; not full-clone parity and not 100-agent scale proof.'
    }
  };
}
function makeQualityRepairHandoff({ args, repoPath, repairSurfaces, cycle, qualityGate }) {
  const cycleId = `quality-repair-${String(cycle).padStart(3, '0')}`;
  const cycleRoot = path.join(args.artifactRoot, 'quality_repair_cycles', cycleId);
  return {
    schemaVersion: 'cortex.agent_work_handoff.v0',
    generatedAt: nowIso(),
    source: 'openclaw-goal-to-pr-coherent-release-autonomous-quality-repair',
    owner: 'Jake',
    goalId: 'goal_to_pr_coherent_release_quality_repair',
    objective: 'Autonomously repair the final production-quality gate for the coherent goal-to-PR release candidate without manual artifact edits.',
    repoPath,
    benchmarkId: 'goal_to_pr_coherent_release',
    benchmarkTier: 'production_quality_repair_smoke',
    runId: `${args.runId}-${cycleId}`,
    artifactRoot: path.join(cycleRoot, 'compiled-agent-work'),
    fidelity: 'production_slice',
    requestedAgentCount: Math.max(1, Math.min(args.requestedAgents, repairSurfaces.length)),
    executionBoundary: 'execution_plane_required',
    stopCondition: 'production_quality_gate_green_or_blocker_report',
    permissions: { allow: ['read_repo', 'edit_product_code', 'run_tests'], forbid: ['external_send', 'deploy_prod', 'touch_prod', 'relaunch_benchmark'] },
    requestedActions: ['repair', 'integrate', 'verify'],
    doneWhen: ['global_route_collision_count == 0', 'test_failure_regression_count == 0', 'duplicate_normalized_line_ratio <= 0.18', 'final_diff_exists'],
    budgets: { token_cap: 600000, worker_prompt_tokens: 12000 },
    wavePolicy: { max_waves: 1, full_context_waves: 0 },
    expansionPolicy: { triggers: [], max_cycles: 0, max_surfaces: repairSurfaces.length },
    evidenceSchemas: [],
    routeLevels: ['L5 oracle', 'L7 librarian', 'L22 mnemosyne', 'L27 forge'],
    surfaces: repairSurfaces,
    metadata: {
      benchmarkSpec: 'goal_to_pr_coherent_release_benchmark_spec_20260615T0031CDT.md',
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      creativeProductWork: {
        required: true,
        workerCommand: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs',
        promptMode: 'compact',
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        compactDensityTarget: 12
      },
      autonomousProductionQualityRepair: true,
      repairCycle: cycle,
      repairSource: 'production_quality_gate',
      sourceFailureReasons: (qualityGate?.failures || []).map((failure) => failure.reason || failure.metric).filter(Boolean),
      sourceRouteCollisionCount: qualityGate?.metrics?.routeCollisionCount ?? null,
      sourceTestFailureRegressionCount: qualityGate?.metrics?.testFailureRegressionCount ?? null,
      noManualArtifactEditsRequired: true,
      truthBoundary: 'Quality repair cycles may edit only the isolated benchmark repo and are scored by the final production-quality gate.'
    }
  };
}
function runQualityGate({ repoPath, baselineRepoPath, artifactRoot, testCommand, skipTests = false }) {
  const args = [QUALITY_GATE, '--repo-path', repoPath, '--baseline-repo-path', baselineRepoPath, '--artifact-root', artifactRoot, '--test-command', testCommand, '--max-route-collisions', '0', '--max-duplicate-normalized-line-ratio', '0.18', '--min-architecture-fitness-score', '0', '--max-architecture-violations', '999'];
  if (skipTests) args.push('--skip-tests');
  return runLogged(process.execPath, args, {
    cwd: STACK_ROOT,
    stdoutPath: path.join(artifactRoot, 'evaluate-production-quality-gate.stdout.json'),
    stderrPath: path.join(artifactRoot, 'evaluate-production-quality-gate.stderr.log'),
    timeoutMs: 45 * 60 * 1000
  });
}
function objectiveControllerEnv(args) {
  return {
    ...process.env,
    PATH: `/home/jake/.local/bin:${process.env.PATH || ''}`,
    CODEX_BIN: process.env.CODEX_BIN || '/home/jake/.local/bin/codex',
    BENCHMARK_HOST_ROLE: 'execution_plane',
    HOST_ROLE: 'execution_plane',
    TRANSFER_ORCHESTRATOR_EXECUTION_PLANE: 'hetzner_clawd_exec_hel1',
    ORCHESTRATOR_WORKER_WORKSPACE_MODE: 'isolated_product_copy',
    ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: 'tests',
    ORCHESTRATOR_PROMOTE_WORKER_WORKSPACE_CHANGES: '1',
    ORCHESTRATOR_MAX_SPAWNS_PER_TICK: String(args.requestedAgents),
    ORCHESTRATOR_CONTEXT_GOVERNOR: '1',
    ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: '0',
    ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: '12000',
    CREATIVE_WORKER_COMMAND: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs',
    CREATIVE_WORKER_PROMPT_MODE: 'compact',
    CREATIVE_WORKER_COMPACT_DENSITY_TARGET_OVERRIDE: '12',
    CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
    CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
    CREATIVE_WORKER_COMMAND_TIMEOUT_MS: String(25 * 60 * 1000),
    CODEX_CREATIVE_SANDBOX: process.env.CODEX_CREATIVE_SANDBOX || 'danger-full-access',
    CODEX_CREATIVE_MAX_ITERATIONS: '4',
    CODEX_CREATIVE_ITERATION_TIMEOUT_MS: String(5 * 60 * 1000),
    CREATIVE_WORKER_EXTERNAL_VERIFICATION: '0',
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: String(Math.max(args.requestedAgents * 2, 20)),
    TRANSFER_BENCHMARK_MAX_RUNTIME_MS: String(60 * 60 * 1000),
    TRANSFER_BENCHMARK_WORKER_TIMEOUT_MS: String(35 * 60 * 1000),
    TRANSFER_BENCHMARK_LEASE_TTL_MS: String(60 * 60 * 1000),
    ORCHESTRATOR_WORKER_TIMEOUT_MS: String(35 * 60 * 1000),
    MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: '0',
    MAILCHIMP_BENCHMARK_SURFACE_MIN_CYCLES_OVERRIDE: '1'
  };
}
function runObjectiveController({ args, compiledDir, controllerRoot, stdoutPath, stderrPath, maxWaves }) {
  if (args.dryRun) return { ok: false, skipped: true };
  return runLogged(process.execPath, [OBJECTIVE_CONTROLLER, compiledDir, '--artifact-root', controllerRoot, '--max-waves', String(maxWaves || args.maxWaves)], {
    cwd: STACK_ROOT,
    env: objectiveControllerEnv(args),
    stdoutPath,
    stderrPath,
    timeoutMs: 3 * 60 * 60 * 1000
  });
}
function readControllerSummary(controllerRoot) {
  return readJson(path.join(controllerRoot, 'objective_controller_summary.json'), null)
    || readJson(path.join(controllerRoot, 'completion_summary.json'), null)
    || null;
}
function evaluateFinalQualityAttempt({ args, repoPath, baselineRepoPath, attemptRoot, testCommand }) {
  const runResult = runQualityGate({ repoPath, baselineRepoPath, artifactRoot: attemptRoot, testCommand, skipTests: false });
  const quality = readJson(path.join(attemptRoot, 'production_quality_gate.json'), null);
  return { runResult, quality, qualityRoot: attemptRoot };
}
function writeQualityRepairLedger(artifactRoot, records) {
  writeJson(path.join(artifactRoot, 'quality_repair_ledger.json'), {
    schemaVersion: 'claw.goal_to_pr_quality_repair_ledger.v0',
    generatedAt: nowIso(),
    manualArtifactEdits: false,
    repairCycleCount: records.length,
    records
  });
}
function writeFinalDiff(repoPath, artifactRoot) {
  const patch = run('git', ['diff', '--binary', 'HEAD', '--', 'apps', 'packages', 'src', 'tests'], { cwd: repoPath, maxBuffer: 128 * 1024 * 1024 });
  const stat = run('git', ['diff', '--stat', 'HEAD', '--', 'apps', 'packages', 'src', 'tests'], { cwd: repoPath });
  fs.writeFileSync(path.join(artifactRoot, 'final_diff.patch'), patch.stdout);
  fs.writeFileSync(path.join(artifactRoot, 'final_diff_stat.txt'), stat.stdout);
  return { patchBytes: Buffer.byteLength(patch.stdout), stat: stat.stdout, files: productDiffFiles(repoPath) };
}
function walkJsonFiles(root, predicate = () => true) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else if (stat.isFile() && current.endsWith('.json') && predicate(current)) {
      out.push(current);
    }
  }
  return out;
}
function collectControllerEvidence(controllerRoot) {
  const summaryFiles = walkJsonFiles(path.join(controllerRoot, 'waves'), (file) => file.includes(`${path.sep}orchestrator_run${path.sep}summary.json`));
  const resultFiles = walkJsonFiles(path.join(controllerRoot, 'waves'), (file) => file.includes(`${path.sep}orchestrator_run${path.sep}results${path.sep}`));
  const summaries = summaryFiles.map((file) => readJson(file, null)).filter(Boolean);
  const results = resultFiles.map((file) => readJson(file, null)).filter(Boolean);
  const creativeResults = results.filter((result) => result?.implementation?.metadata?.productDiffMode === 'creative_product_work' || result?.implementation?.metadata?.creativeProductWorkRequired === true);
  const realWorkerResults = creativeResults.filter((result) => {
    const implementation = result.implementation || {};
    const metadata = implementation.metadata || {};
    const command = String(implementation.command || metadata.workerCommand || '');
    return /codex-creative-worker|\bcodex\b/.test(command)
      && Number(implementation.durationMs || 0) > 0
      && (implementation.modifiedFiles || []).some((file) => /^(apps|packages|src)\//.test(file));
  });
  const mergedCreativeResults = creativeResults.filter((result) => result?.ok === true && (result?.implementation?.modifiedFiles || []).length > 0);
  const maxPeakConcurrency = summaries.reduce((max, summary) => Math.max(max, Number(summary?.metrics?.peakConcurrentWorkers || summary?.peakConcurrency || 0)), 0);
  const uniqueAgentIds = new Set();
  for (const summary of summaries) {
    for (const agentId of summary?.metrics?.observedAgentIds || summary?.concurrencyTruth?.uniqueAgentIds || []) uniqueAgentIds.add(agentId);
  }
  const mergedShardCount = summaries.reduce((sum, summary) => sum + Number(summary?.metrics?.mergedPatchCount || summary?.mergedShardCount || 0), 0);
  return {
    summaryFileCount: summaryFiles.length,
    resultFileCount: resultFiles.length,
    creativeResultCount: creativeResults.length,
    realWorkerResultCount: realWorkerResults.length,
    mergedCreativeResultCount: mergedCreativeResults.length,
    maxPeakConcurrency,
    uniqueAgentCount: uniqueAgentIds.size,
    mergedShardCount,
    realWorkerResultExamples: realWorkerResults.slice(0, 5).map((result) => ({
      shardId: result.shardId,
      agentId: result.agentId,
      command: result.implementation?.command || result.implementation?.metadata?.workerCommand || null,
      durationMs: result.implementation?.durationMs || null,
      modifiedFiles: result.implementation?.modifiedFiles || []
    }))
  };
}
function collectControllerEvidenceAcross(controllerRoots = []) {
  const evidence = stableList(controllerRoots).map((root) => ({ root, evidence: collectControllerEvidence(root) }));
  return {
    controllerRoots: evidence.map((entry) => entry.root),
    summaryFileCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.summaryFileCount || 0), 0),
    resultFileCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.resultFileCount || 0), 0),
    creativeResultCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.creativeResultCount || 0), 0),
    realWorkerResultCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.realWorkerResultCount || 0), 0),
    mergedCreativeResultCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.mergedCreativeResultCount || 0), 0),
    maxPeakConcurrency: evidence.reduce((max, entry) => Math.max(max, Number(entry.evidence.maxPeakConcurrency || 0)), 0),
    uniqueAgentCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.uniqueAgentCount || 0), 0),
    mergedShardCount: evidence.reduce((sum, entry) => sum + Number(entry.evidence.mergedShardCount || 0), 0),
    realWorkerResultExamples: evidence.flatMap((entry) => (entry.evidence.realWorkerResultExamples || []).map((example) => ({ ...example, controllerRoot: entry.root }))).slice(0, 8),
    perController: evidence
  };
}
function controllerTruthLayer(controllerSummary = null, controllerState = null) {
  const thresholdPass = controllerSummary?.thresholdPass === true || controllerState?.thresholdPass === true;
  return {
    thresholdPass,
    status: thresholdPass ? 'controller_green' : 'controller_red',
    blockerFamily: controllerState?.blocker?.blockerFamily || controllerSummary?.blocker?.blockerFamily || null,
    interpretation: thresholdPass ? 'inner_objective_controller_green' : 'inner_controller_red_top_level_release_gate_may_still_pass',
    note: thresholdPass
      ? 'The inner objective controller reached its own threshold.'
      : 'The inner controller scores all shard merge efficiency. The top-level coherent-release benchmark is separately scored from final release quality gates and required merged-patch count.'
  };
}

function writeReviewPacket({ artifactRoot, args, repoPath, baselineQuality, finalQuality, controllerSummary, controllerTruth, finalDiff, controllerEvidence, qualityRepairRecords = [] }) {
  const routeAudit = finalQuality?.routeAudit || {};
  const finalSummary = finalQuality?.finalTestSummary || null;
  const baselineSummary = finalQuality?.baselineTestSummary || baselineQuality?.finalTestSummary || null;
  const repairLines = qualityRepairRecords.length
    ? qualityRepairRecords.map((record) => `- Cycle ${record.cycle}: surfaces=${record.generatedSurfaceCount}, controllerOk=${record.controllerRunOk === true}, postRepairQualityOk=${record.postRepairQualityOk === true}, routeCollisions=${record.postRepairRouteCollisionCount ?? 'unknown'}, testRegressions=${record.postRepairTestFailureRegressionCount ?? 'unknown'}`).join('\n')
    : '- No autonomous production-quality repair cycle was needed or attempted.';
  const text = `# Goal-to-PR coherent release review packet\n\nGenerated: ${nowIso()}\n\n## Objective\n\nRepair duplicate route collisions in the post-run Mailchimp artifact and package a coherent release-candidate diff.\n\n## Benchmark contract\n\n- Run id: ${args.runId}\n- Requested agents: ${args.requestedAgents}\n- Max waves: ${args.maxWaves}\n- Max autonomous quality repair cycles: ${args.maxQualityRepairCycles}\n- Fidelity: production_slice\n- Stop condition: objective_green_with_quality_gates_or_blocker_report\n- Target repo: ${repoPath}\n\n## Baseline\n\n- Baseline route collisions: ${baselineQuality?.metrics?.routeCollisionCount ?? 'unknown'}\n- Baseline tests: ${baselineSummary ? `${baselineSummary.pass}/${baselineSummary.tests} pass, ${baselineSummary.fail} fail` : 'not recorded'}\n\n## Final quality gate\n\n- Gate ok: ${finalQuality?.ok === true}\n- Final route collisions: ${finalQuality?.metrics?.routeCollisionCount ?? 'unknown'}\n- Test failure regression count: ${finalQuality?.metrics?.testFailureRegressionCount ?? 'unknown'}\n- Final tests: ${finalSummary ? `${finalSummary.pass}/${finalSummary.tests} pass, ${finalSummary.fail} fail` : 'not recorded'}\n- Duplicate normalized line ratio: ${finalQuality?.metrics?.duplicateNormalizedLineRatio ?? 'unknown'}\n\n## Autonomous quality repair loop\n\n- Manual artifact edits: false\n- Repair cycles recorded: ${qualityRepairRecords.length}\n${repairLines}\n\n## Route map before/after\n\n### Baseline duplicate routes\n\n\`\`\`json\n${JSON.stringify(baselineQuality?.routeAudit?.duplicateRoutes || [], null, 2)}\n\`\`\`\n\n### Final duplicate routes\n\n\`\`\`json\n${JSON.stringify(routeAudit.duplicateRoutes || [], null, 2)}\n\`\`\`\n\n## Objective-controller result\n\n- Controller status: ${controllerSummary?.status || 'unknown'}\n- Controller thresholdPass: ${controllerSummary?.thresholdPass === true}\n- Controller truth interpretation: ${controllerTruth?.interpretation || 'unknown'}\n- Minimum merged shards required by top-level gate: ${args.minMergedShards}\n- Wave count: ${controllerSummary?.waveCount ?? 'unknown'}\n- Expansion count: ${controllerSummary?.expansionCount ?? 'unknown'}\n- Final wave: ${controllerSummary?.finalWave?.waveRoot || 'unknown'}\n- Real creative worker results: ${controllerEvidence?.realWorkerResultCount ?? 'unknown'}\n- Max observed concurrency: ${controllerEvidence?.maxPeakConcurrency ?? 'unknown'}\n- Merged shard count: ${controllerEvidence?.mergedShardCount ?? 'unknown'}\n\n## Final diff\n\n- Changed files: ${finalDiff.files.length}\n- Patch bytes: ${finalDiff.patchBytes}\n\n\`\`\`\n${finalDiff.stat || '(empty diff)'}\n\`\`\`\n\n## Rollback notes\n\nThis benchmark worktree is isolated. To roll back the repair inside the benchmark repo, run:\n\n\`\`\`bash\ngit -C ${repoPath} reset --hard HEAD\n\`\`\`\n\n## Truth boundary\n\nThis packet supports only the coherent-release benchmark result for the isolated artifact repo. It is not a Mailchimp full-clone/parity claim and not a 100-agent scale proof.\n`;
  fs.writeFileSync(path.join(artifactRoot, 'review_packet.md'), text);
  return { path: path.join(artifactRoot, 'review_packet.md'), bytes: Buffer.byteLength(text) };
}

const args = parseArgs(process.argv.slice(2));
const artifactRoot = args.artifactRoot;
const workspaceRoot = path.join(artifactRoot, 'workspace');
const repoPath = path.join(workspaceRoot, 'repo');
const baselineRepoPath = path.join(workspaceRoot, 'baseline_repo');
const compiledDir = path.join(artifactRoot, 'compiled-agent-work');
const controllerRoot = path.join(artifactRoot, 'objective_controller');

ensureFreshDir(artifactRoot, args.keepExisting);
writeJson(path.join(artifactRoot, 'benchmark_contract.json'), {
  schemaVersion: 'claw.goal_to_pr_coherent_release_contract.v0',
  generatedAt: nowIso(),
  runId: args.runId,
  sourceRepo: args.sourceRepo,
  repoPath,
  baselineRepoPath,
  requestedAgents: args.requestedAgents,
  maxWaves: args.maxWaves,
  maxQualityRepairCycles: args.maxQualityRepairCycles,
  minMergedShards: args.minMergedShards,
  testCommand: args.testCommand,
  stopCondition: 'objective_green_with_quality_gates_or_blocker_report',
  executionBoundary: 'execution_plane_required',
  fidelity: 'production_slice'
});
writeAcceptanceCriteria(artifactRoot, args);

if (!fs.existsSync(args.sourceRepo)) {
  const blocker = { blockerFamily: 'source_repo_missing', blocker: `Source repo does not exist: ${args.sourceRepo}`, nextAction: 'Restore or point --source-repo at the post-run Mailchimp artifact repo.' };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'completion_summary.json'), { thresholdPass: false, status: 'blocked', blocker });
  console.log(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exit(2);
}

rsyncCopy(args.sourceRepo, baselineRepoPath);
rsyncCopy(args.sourceRepo, repoPath);
const baselineCommit = commitBaseline(repoPath);
writeJson(path.join(artifactRoot, 'baseline_commit.json'), baselineCommit);

const baselineQualityRoot = path.join(artifactRoot, 'preflight');
const baselineQualityRun = runQualityGate({ repoPath: baselineRepoPath, baselineRepoPath, artifactRoot: baselineQualityRoot, testCommand: args.testCommand, skipTests: args.skipBaselineTests });
const baselineQuality = readJson(path.join(baselineQualityRoot, 'production_quality_gate.json'), null);
writeJson(path.join(artifactRoot, 'preflight_summary.json'), { run: baselineQualityRun, baselineQuality });

const handoff = makeHandoff(args, repoPath);
writeJson(path.join(artifactRoot, 'cortex_handoff.json'), handoff);
const compileRun = runLogged(process.execPath, [COMPILE_CORTEX_AGENT_WORK, path.join(artifactRoot, 'cortex_handoff.json'), '--out', compiledDir, '--repo', repoPath, '--run-id', args.runId], {
  cwd: STACK_ROOT,
  stdoutPath: path.join(artifactRoot, 'compile-cortex-agent-work.stdout.json'),
  stderrPath: path.join(artifactRoot, 'compile-cortex-agent-work.stderr.log')
});
if (!compileRun.ok) {
  const blocker = { blockerFamily: 'agent_work_compile_failed', blocker: 'Cortex Agent Work handoff failed to compile.', nextAction: 'Inspect compile-cortex-agent-work stderr and repair the handoff/schema.', compileRun };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'completion_summary.json'), { thresholdPass: false, status: 'blocked', blocker });
  console.log(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exit(2);
}

const controllerRuns = [];
let controllerRun = runObjectiveController({
  args,
  compiledDir,
  controllerRoot,
  stdoutPath: path.join(artifactRoot, 'objective-controller.stdout.json'),
  stderrPath: path.join(artifactRoot, 'objective-controller.stderr.log'),
  maxWaves: args.maxWaves
});
controllerRuns.push({ phase: 'initial', controllerRoot, run: controllerRun });

let controllerSummary = readControllerSummary(controllerRoot);
let controllerState = readJson(path.join(controllerRoot, 'objective_controller_state.json'), null);
let controllerTruth = controllerTruthLayer(controllerSummary, controllerState);
let finalQualityRoot = path.join(artifactRoot, 'quality_attempts', 'attempt-000');
let finalQualityRun = evaluateFinalQualityAttempt({ args, repoPath, baselineRepoPath, attemptRoot: finalQualityRoot, testCommand: args.testCommand }).runResult;
let finalQuality = readJson(path.join(finalQualityRoot, 'production_quality_gate.json'), null);
const qualityRepairRecords = [];

for (let cycle = 1; finalQuality?.ok !== true && cycle <= args.maxQualityRepairCycles; cycle += 1) {
  const repairRoot = path.join(artifactRoot, 'quality_repair_cycles', `quality-repair-${String(cycle).padStart(3, '0')}`);
  const repairSurfaces = normalizeGoalRepairSurfaces(createProductionQualityRepairSurfaces({
    qualityGate: finalQuality || {},
    state: { thresholdMetrics: finalQuality?.metrics || {} },
    waveNumber: cycle,
    maxSurfaces: args.requestedAgents
  }));
  const repairRecord = {
    cycle,
    repairRoot,
    sourceQualityRoot: finalQualityRoot,
    sourceQualityOk: finalQuality?.ok === true,
    sourceFailures: finalQuality?.failures || [],
    generatedSurfaceCount: repairSurfaces.length,
    repairSurfaceIds: repairSurfaces.map((surface) => surface.id),
    manualArtifactEdits: false
  };
  writeJson(path.join(repairRoot, 'generated_repair_surfaces.json'), repairSurfaces);
  if (!repairSurfaces.length) {
    repairRecord.blocker = {
      blockerFamily: 'production_quality_repair_surface_generation_empty',
      blocker: 'The final production-quality gate failed, but no executable repair surfaces could be generated.',
      nextAction: 'Inspect production_quality_gate.json and extend createProductionQualityRepairSurfaces for this failure type.'
    };
    qualityRepairRecords.push(repairRecord);
    break;
  }

  const repairHandoff = makeQualityRepairHandoff({ args, repoPath, repairSurfaces, cycle, qualityGate: finalQuality });
  const repairHandoffPath = path.join(repairRoot, 'cortex_handoff.json');
  const repairCompiledDir = path.join(repairRoot, 'compiled-agent-work');
  const repairControllerRoot = path.join(repairRoot, 'objective_controller');
  writeJson(repairHandoffPath, repairHandoff);
  const repairCompileRun = runLogged(process.execPath, [COMPILE_CORTEX_AGENT_WORK, repairHandoffPath, '--out', repairCompiledDir, '--repo', repoPath, '--run-id', repairHandoff.runId], {
    cwd: STACK_ROOT,
    stdoutPath: path.join(repairRoot, 'compile-cortex-agent-work.stdout.json'),
    stderrPath: path.join(repairRoot, 'compile-cortex-agent-work.stderr.log')
  });
  repairRecord.compileOk = repairCompileRun.ok;
  if (!repairCompileRun.ok) {
    repairRecord.blocker = {
      blockerFamily: 'production_quality_repair_compile_failed',
      blocker: 'Generated production-quality repair surfaces did not compile into an Agent Work run contract.',
      nextAction: 'Inspect the repair compile stderr and generated_repair_surfaces.json.',
      compileRun: repairCompileRun
    };
    qualityRepairRecords.push(repairRecord);
    break;
  }

  const repairControllerRun = runObjectiveController({
    args,
    compiledDir: repairCompiledDir,
    controllerRoot: repairControllerRoot,
    stdoutPath: path.join(repairRoot, 'objective-controller.stdout.json'),
    stderrPath: path.join(repairRoot, 'objective-controller.stderr.log'),
    maxWaves: 1
  });
  controllerRuns.push({ phase: `quality_repair_${cycle}`, controllerRoot: repairControllerRoot, run: repairControllerRun });
  repairRecord.controllerRunOk = repairControllerRun.ok;
  repairRecord.controllerRoot = repairControllerRoot;
  repairRecord.controllerSummary = readControllerSummary(repairControllerRoot);

  finalQualityRoot = path.join(artifactRoot, 'quality_attempts', `attempt-${String(cycle).padStart(3, '0')}`);
  finalQualityRun = evaluateFinalQualityAttempt({ args, repoPath, baselineRepoPath, attemptRoot: finalQualityRoot, testCommand: args.testCommand }).runResult;
  finalQuality = readJson(path.join(finalQualityRoot, 'production_quality_gate.json'), null);
  repairRecord.postRepairQualityRoot = finalQualityRoot;
  repairRecord.postRepairQualityOk = finalQuality?.ok === true;
  repairRecord.postRepairRouteCollisionCount = finalQuality?.metrics?.routeCollisionCount ?? null;
  repairRecord.postRepairTestFailureRegressionCount = finalQuality?.metrics?.testFailureRegressionCount ?? null;
  qualityRepairRecords.push(repairRecord);
}

writeQualityRepairLedger(artifactRoot, qualityRepairRecords);
const selectedFinalQualityRoot = finalQualityRoot;
const canonicalFinalQualityRoot = path.join(artifactRoot, 'final_quality');
if (selectedFinalQualityRoot !== canonicalFinalQualityRoot && fs.existsSync(selectedFinalQualityRoot)) {
  fs.rmSync(canonicalFinalQualityRoot, { recursive: true, force: true });
  fs.cpSync(selectedFinalQualityRoot, canonicalFinalQualityRoot, { recursive: true });
  writeJson(path.join(canonicalFinalQualityRoot, 'source_attempt.json'), { sourceFinalQualityRoot: selectedFinalQualityRoot });
  finalQualityRoot = canonicalFinalQualityRoot;
}
controllerSummary = readControllerSummary(controllerRoot);
controllerState = readJson(path.join(controllerRoot, 'objective_controller_state.json'), null);
controllerTruth = controllerTruthLayer(controllerSummary, controllerState);
const fullSuite = runLogged('bash', ['-lc', args.testCommand], {
  cwd: repoPath,
  stdoutPath: path.join(artifactRoot, 'full_suite_test_log.txt'),
  stderrPath: path.join(artifactRoot, 'full_suite_test_stderr.log'),
  timeoutMs: 45 * 60 * 1000
});
writeJson(path.join(artifactRoot, 'full_suite_test_command.json'), fullSuite);
writeJson(path.join(artifactRoot, 'final_quality_run.json'), finalQualityRun);
if (finalQuality?.routeAudit) writeJson(path.join(artifactRoot, 'route_duplicate_audit.json'), finalQuality.routeAudit);
if (finalQuality) writeJson(path.join(artifactRoot, 'production_quality_gate.json'), finalQuality);
const finalDiff = writeFinalDiff(repoPath, artifactRoot);
const controllerEvidence = collectControllerEvidenceAcross(controllerRuns.map((entry) => entry.controllerRoot));
writeJson(path.join(artifactRoot, 'controller_evidence_summary.json'), controllerEvidence);
const reviewPacket = writeReviewPacket({ artifactRoot, args, repoPath, baselineQuality, finalQuality, controllerSummary, controllerTruth, finalDiff, controllerEvidence, qualityRepairRecords });
const changedProductFiles = finalDiff.files.filter((file) => /^(apps|packages|src)\//.test(file) && /\.(?:mjs|js|jsx|ts|tsx|html|css|json)$/.test(file));
const thresholdFailures = [];
const pushFailure = (metric, actual, requirement, reason) => thresholdFailures.push({ metric, actual, requirement, reason });
if (controllerRun.skipped) pushFailure('controllerRun', 'dry_run', 'real objective-controller run', 'dry_run');
if (finalQuality?.ok !== true) pushFailure('productionQualityGatePass', finalQuality?.ok ?? null, '= true', 'production_quality_gate_failed');
if (Number(finalQuality?.metrics?.routeCollisionCount ?? 999) !== 0) pushFailure('routeCollisionCount', finalQuality?.metrics?.routeCollisionCount ?? null, '= 0', 'route_collision_detected');
if (Number(finalQuality?.metrics?.testFailureRegressionCount ?? 999) !== 0) pushFailure('testFailureRegressionCount', finalQuality?.metrics?.testFailureRegressionCount ?? null, '= 0', 'test_regression_introduced');
if (finalDiff.patchBytes <= 0) pushFailure('finalDiffBytes', finalDiff.patchBytes, '> 0', 'final_diff_missing');
if (changedProductFiles.length <= 0) pushFailure('changedProductFiles', changedProductFiles.length, '> 0', 'product_diff_missing');
if (Number(controllerEvidence?.realWorkerResultCount || 0) <= 0) pushFailure('realCreativeWorkerResults', controllerEvidence?.realWorkerResultCount ?? null, '> 0', 'real_creative_worker_evidence_missing');
if (Number(controllerEvidence?.mergedShardCount || 0) < args.minMergedShards) pushFailure('mergedCreativeShards', controllerEvidence?.mergedShardCount ?? null, `>= ${args.minMergedShards}`, 'merged_product_patch_below_required_count');
if (!fs.existsSync(reviewPacket.path) || reviewPacket.bytes <= 0) pushFailure('reviewPacket', reviewPacket.bytes, '> 0', 'review_packet_missing');

const thresholdPass = thresholdFailures.length === 0;
const thresholdEvaluation = {
  schemaVersion: 'claw.goal_to_pr_coherent_release_threshold.v0',
  generatedAt: nowIso(),
  benchmarkId: 'goal_to_pr_coherent_release',
  runId: args.runId,
  thresholdPass,
  failures: thresholdFailures,
  metrics: {
    controllerThresholdPass: controllerSummary?.thresholdPass === true ? 1 : 0,
    minMergedShards: args.minMergedShards,
    mergedShardCount: controllerEvidence.mergedShardCount,
    mergedCreativeResultCount: controllerEvidence.mergedCreativeResultCount,
    routeCollisionCount: finalQuality?.metrics?.routeCollisionCount ?? null,
    finalTestFailureCount: finalQuality?.metrics?.finalTestFailureCount ?? null,
    baselineTestFailureCount: finalQuality?.metrics?.baselineTestFailureCount ?? null,
    testFailureRegressionCount: finalQuality?.metrics?.testFailureRegressionCount ?? null,
    duplicateNormalizedLineRatio: finalQuality?.metrics?.duplicateNormalizedLineRatio ?? null,
    finalDiffBytes: finalDiff.patchBytes,
    changedProductFileCount: changedProductFiles.length,
    realCreativeWorkerResultCount: controllerEvidence.realWorkerResultCount,
    maxPeakConcurrency: controllerEvidence.maxPeakConcurrency,
    qualityRepairCycleCount: qualityRepairRecords.length,
    autonomousQualityRepairUsed: qualityRepairRecords.length > 0 ? 1 : 0,
    manualArtifactEdits: 0,
    reviewPacketBytes: reviewPacket.bytes
  },
  controllerTruth,
  truthBoundary: 'Coherent goal-to-PR benchmark only; not full-clone parity and not 100-agent scale proof.'
};
writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), thresholdEvaluation);
let blocker = null;
if (!thresholdPass) {
  blocker = {
    generatedAt: nowIso(),
    blockerFamily: 'goal_to_pr_coherent_release_not_green',
    blocker: 'The coherent-release benchmark did not satisfy all top-level quality gates.',
    nextAction: 'Inspect threshold_evaluation.json, production_quality_gate.json, quality_repair_ledger.json, objective_controller_state.json, and final diff/review packet before relaunching.',
    failures: thresholdFailures
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
}
const completion = {
  schemaVersion: 'claw.goal_to_pr_coherent_release_completion.v0',
  generatedAt: nowIso(),
  benchmarkId: 'goal_to_pr_coherent_release',
  runId: args.runId,
  status: thresholdPass ? 'threshold_pass' : 'blocked',
  thresholdPass,
  mechanicalGreen: finalQuality?.ok === true && finalDiff.patchBytes > 0 && changedProductFiles.length > 0,
  controllerThresholdPass: controllerSummary?.thresholdPass === true,
  controllerTruth,
  qualityRepair: {
    autonomous: true,
    manualArtifactEdits: false,
    maxQualityRepairCycles: args.maxQualityRepairCycles,
    cycleCount: qualityRepairRecords.length,
    records: qualityRepairRecords.map((record) => ({
      cycle: record.cycle,
      generatedSurfaceCount: record.generatedSurfaceCount,
      controllerRunOk: record.controllerRunOk === true,
      postRepairQualityOk: record.postRepairQualityOk === true,
      postRepairRouteCollisionCount: record.postRepairRouteCollisionCount ?? null,
      postRepairTestFailureRegressionCount: record.postRepairTestFailureRegressionCount ?? null,
      repairRoot: record.repairRoot
    }))
  },
  truthLayers: {
    topLevelCoherentReleaseGate: {
      thresholdPass,
      finalQualityGatePass: finalQuality?.ok === true,
      minMergedShards: args.minMergedShards,
      mergedShardCount: controllerEvidence?.mergedShardCount ?? 0
    },
    innerObjectiveController: controllerTruth
  },
  scaleProofReady: controllerSummary?.finalWave?.scaleProofReady ?? controllerSummary?.scaleProofReady ?? false,
  requestedAgentCount: args.requestedAgents,
  artifactRoot,
  repoPath,
  baselineRepoPath,
  controllerRoot,
  finalQualityRoot,
  finalDiffPath: path.join(artifactRoot, 'final_diff.patch'),
  reviewPacketPath: reviewPacket.path,
  blocker,
  truthBoundary: thresholdEvaluation.truthBoundary
};
writeJson(path.join(artifactRoot, 'completion_summary.json'), completion);
console.log(JSON.stringify({ ok: thresholdPass, thresholdPass, artifactRoot, repoPath, controllerRoot, finalQualityRoot, blocker }, null, 2));
process.exit(thresholdPass ? 0 : 1);
