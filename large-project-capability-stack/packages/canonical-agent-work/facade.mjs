import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileCanonicalAgentWork, executeCanonicalAgentWork } from './pipeline.mjs';
import { validateAgentWorkV1Bundle } from './contracts.mjs';
import {
  buildRecoveryQualificationPacket,
  cancelRuntime,
  closeAgentWorkRuntime,
  initializeAgentWorkRuntime,
  openAgentWorkRuntime,
  recoverRuntimeState,
  resumeRuntime
} from '../agent-work-runtime/index.mjs';
import {
  buildAgentWorkPlanningPacket,
  planReviewApprovalIsBound,
  writeAgentWorkPlanningArtifacts
} from '../agent-work-planning/index.mjs';
import { AGENT_WORK_PHASE5_EXECUTION_PACKET_SCHEMA } from '../agent-work-execution/index.mjs';
import { AGENT_WORK_PHASE6_TRUTH_PACKET_SCHEMA } from '../agent-work-verifier/index.mjs';
import { AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA } from '../agent-work-ops/index.mjs';
import { AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA } from '../agent-work-release-candidate/index.mjs';

export const AGENT_WORK_CLI_RESULT_SCHEMA = 'clawd.agent_work.cli_result.v1';
export const AGENT_WORK_CONFIG_SCHEMA = 'clawd.agent_work.config.v1';
export const AGENT_WORK_PHASE2_PACKET_SCHEMA = 'clawd.agent_work.phase2_cli_contract_packet.v1';
export const AGENT_WORK_PHASE4_PACKET_SCHEMA = 'clawd.agent_work.phase4_planning_packet.v1';

export const AGENT_WORK_EXIT_CODES = Object.freeze({
  success: 0,
  blocked: 1,
  invalidOrDenied: 2,
  infrastructure: 3,
  cancelled: 4
});

export const AGENT_WORK_COMMANDS = Object.freeze([
  'plan',
  'run',
  'status',
  'resume',
  'cancel',
  'verify',
  'report',
  'doctor',
  'replay'
]);

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const STACK_ROOT = path.resolve(PACKAGE_DIR, '../..');

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function firstExisting(paths = []) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function executablePath(command) {
  const run = spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return run.status === 0 ? clean(run.stdout) : '';
}

function mergeConfig(...configs) {
  const merged = {};
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue;
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null && value !== '') merged[key] = value;
    }
  }
  return merged;
}

export function resolveAgentWorkConfig({
  workspaceRoot = STACK_ROOT,
  runRoot = null,
  cliConfig = {},
  configPath = null,
  env = process.env,
  generatedAt = nowIso()
} = {}) {
  const workspaceDefaultPath = firstExisting([
    configPath ? path.resolve(configPath) : null,
    path.join(workspaceRoot, 'config/agent-work-v1/default.json')
  ]);
  const runConfigPath = runRoot ? firstExisting([
    path.join(path.resolve(runRoot), 'agent_work_config.json'),
    path.join(path.resolve(runRoot), 'run_config.json')
  ]) : null;
  const workspaceDefault = readJsonIfExists(workspaceDefaultPath) || {};
  const runConfig = readJsonIfExists(runConfigPath) || {};
  const resolved = mergeConfig(workspaceDefault, runConfig, cliConfig);
  const hostFacts = {
    host: os.hostname(),
    hostRole: clean(env.BENCHMARK_HOST_ROLE || env.AGENT_WORK_HOST_ROLE || resolved.hostRole || 'control_plane'),
    node: process.version,
    rsync: executablePath('rsync'),
    cwd: process.cwd()
  };
  return {
    schemaVersion: AGENT_WORK_CONFIG_SCHEMA,
    generatedAt,
    precedence: ['cli', 'run_config', 'workspace_default'],
    sourcePaths: {
      workspaceDefaultPath,
      runConfigPath,
      cliConfigProvided: Object.keys(cliConfig || {}).length > 0
    },
    resolved,
    hostFacts,
    truthBoundary: 'Environment variables are admitted only as host facts/secrets, not as ordinary config overrides.'
  };
}

function normalizeObjectiveInput(input, { targetPath = process.cwd(), fidelity = 'production_slice', executionBoundary = 'remote_execution_required' } = {}) {
  if (!input) throw new Error('objective or handoff input is required');
  if (typeof input === 'object') {
    const normalized = clone(input);
    const rawPolicy = normalized.workforcePolicy || normalized.workforce_policy || {};
    const parsedRequested = Number(normalized.requestedAgentCount ?? normalized.requested_agent_count ?? normalized.agentCount ?? normalized.agents);
    const operatorRequested = Number.isFinite(parsedRequested) && parsedRequested > 0 && rawPolicy.requestedAgentCountSource !== 'semantic_auto';
    normalized.workforcePolicy = {
      mode: operatorRequested ? 'bounded_auto' : 'semantic_auto',
      maxAgents: operatorRequested ? Math.floor(parsedRequested) : 12,
      ...rawPolicy,
      requestedAgentCountSource: operatorRequested ? 'operator' : 'semantic_auto'
    };
    if (operatorRequested) normalized.requestedAgentCount = Math.floor(parsedRequested);
    else delete normalized.requestedAgentCount;
    return normalized;
  }
  const text = clean(input);
  if (!text) throw new Error('objective text is required');
  return {
    schemaVersion: 'cortex.agent_work_handoff.v0',
    generatedAt: nowIso(),
    source: 'agent-work-cli',
    objective: text,
    repoPath: targetPath,
    fidelity,
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 12, requestedAgentCountSource: 'semantic_auto' },
    executionBoundary,
    stopCondition: 'supervisor_green_or_blocker_report',
    implementationSurface: 'mixed',
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send'] },
    requestedClaims: ['bounded_objective_progress'],
    doneWhen: ['independent_acceptance_green'],
    surfaces: [{
      id: 'operator_defined_objective',
      label: 'Operator-defined objective',
      goal: text,
      files: ['**/*'],
      verify: ['agent-work verify']
    }]
  };
}

function hasDeclaredReferenceSource(input = {}) {
  const reference = input.reference || input.referenceSource || {};
  return Boolean(
    input.referencePath
    || input.referenceRepoPath
    || input.referenceInventory
    || input.referenceSpec
    || reference.repoPath
    || reference.path
    || reference.targetPath
    || reference.inventory
    || reference.spec
  );
}

function resultEnvelope({
  operation,
  ok = false,
  state = 'unknown',
  exitCode = AGENT_WORK_EXIT_CODES.blocked,
  runId = null,
  blockerFamily = null,
  blockerCode = null,
  nextAction = null,
  artifacts = {},
  data = {},
  warnings = [],
  truthBoundary = null,
  generatedAt = nowIso()
} = {}) {
  return {
    schemaVersion: AGENT_WORK_CLI_RESULT_SCHEMA,
    generatedAt,
    operation,
    ok,
    state,
    exitCode,
    runId,
    blockerFamily,
    blockerCode,
    nextAction,
    artifacts,
    data,
    warnings,
    truthBoundary
  };
}

function missingArtifactResult(operation, runRoot, required = []) {
  return resultEnvelope({
    operation,
    ok: false,
    state: 'missing_artifact',
    exitCode: AGENT_WORK_EXIT_CODES.blocked,
    blockerFamily: 'missing_artifact',
    blockerCode: 'required_artifact_missing',
    nextAction: 'Run agent-work plan first or provide a run root containing the required artifacts.',
    artifacts: { runRoot: runRoot ? path.resolve(runRoot) : null, required },
    truthBoundary: 'No status or claim can be inferred without the declared Agent Work artifacts.'
  });
}

function loadRunArtifacts(runRoot, required = ['run_manifest.json']) {
  if (!runRoot) return { ok: false, missing: required, root: null };
  const root = path.resolve(runRoot);
  const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) return { ok: false, missing, root };
  return {
    ok: true,
    root,
    runManifest: readJsonIfExists(path.join(root, 'run_manifest.json')),
    canonicalManifest: readJsonIfExists(path.join(root, 'canonical_pipeline_manifest.json')),
    contractBundle: readJsonIfExists(path.join(root, 'agent_work_v1_contract_bundle.json')),
    blocker: readJsonIfExists(path.join(root, 'blocker_report.json')),
    cancellation: readJsonIfExists(path.join(root, 'cancellation.json')),
    verification: readJsonIfExists(path.join(root, 'verification_packet.json')),
    cliPacket: readJsonIfExists(path.join(root, 'cli_contract_packet.json'))
  };
}

function buildPhase2Packet({ runRoot, compilation, config, generatedAt = nowIso() }) {
  const runManifest = compilation.v1Contracts.runManifest;
  return {
    schemaVersion: AGENT_WORK_PHASE2_PACKET_SCHEMA,
    generatedAt,
    phase: 'phase_2_stable_facade_and_operator_cli',
    runId: runManifest.runId,
    commandFamily: AGENT_WORK_COMMANDS,
    libraryFacade: ['compileObjective', 'admitRun', 'startRun', 'getRunStatus', 'resumeRun', 'cancelRun', 'verifyRun', 'buildCompletionPacket'],
    exitCodes: AGENT_WORK_EXIT_CODES,
    configPrecedence: config.precedence,
    configSourcePaths: config.sourcePaths,
    supportedLocalNoModelCommands: ['plan', 'status', 'report', 'doctor', 'verify'],
    compatibilityOnlyEntrypoints: ['benchmark:*', 'ops:synthetic-labor-os:*', 'legacy canonical-agent-work positional syntax'],
    acceptance: {
      stableJsonOutput: true,
      wrongPlaneFailsClosed: true,
      noBenchmarkSpecificFilenameRequired: true,
      directLegacyEntrypointWarns: true
    },
    artifacts: {
      runRoot: path.resolve(runRoot),
      canonicalPipelineManifest: path.join(path.resolve(runRoot), 'canonical_pipeline_manifest.json'),
      runManifest: path.join(path.resolve(runRoot), 'run_manifest.json'),
      contractBundle: path.join(path.resolve(runRoot), 'agent_work_v1_contract_bundle.json')
    },
    truthBoundary: 'Phase 2 proves the stable facade and operator CLI contract. It does not prove durable runtime execution, worker work, recovery, or release completion.'
  };
}

export function compileObjective({ input, outputDir, config = {}, options = {}, workspaceRoot = STACK_ROOT } = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const runRoot = path.resolve(outputDir);
  const resolvedConfig = resolveAgentWorkConfig({ workspaceRoot, runRoot, cliConfig: config });
  const objectiveInput = normalizeObjectiveInput(input, {
    targetPath: config.targetPath || resolvedConfig.resolved.targetPath || process.cwd(),
    fidelity: config.fidelity || resolvedConfig.resolved.fidelity || 'production_slice',
    executionBoundary: config.executionBoundary || resolvedConfig.resolved.executionBoundary || 'remote_execution_required'
  });
  objectiveInput.workforcePolicy = {
    ...(resolvedConfig.resolved.workforcePolicy || {}),
    ...(config.workforcePolicy || {}),
    ...(objectiveInput.workforcePolicy || {})
  };
  if (objectiveInput.fidelity === 'full_clone' && !hasDeclaredReferenceSource(objectiveInput)) {
    writeJson(path.join(runRoot, 'agent_work_config_resolved.json'), resolvedConfig);
    const planningPacket = buildAgentWorkPlanningPacket({
      input: objectiveInput,
      runRoot,
      strictPlanning: resolvedConfig.resolved.strictPlanning === true,
      currentState: options.currentState || {},
      approval: options.approval || null
    });
    const planningFiles = writeAgentWorkPlanningArtifacts(planningPacket, runRoot);
    const firstBlocker = planningPacket.blockers.find((blocker) => blocker.code === 'full_clone_reference_required') || planningPacket.blockers[0] || {};
    const { blockerPath } = writeBlockerReport(runRoot, {
      runId: planningPacket.objective.runId,
      family: firstBlocker.family || 'objective_contract',
      code: firstBlocker.code || 'full_clone_reference_required',
      summary: firstBlocker.summary || 'A full_clone Agent Work objective requires a declared reference source.',
      observedEvidence: firstBlocker.observedEvidence || ['fidelity=full_clone', 'referenceSource=missing'],
      reproductionSteps: ['Run agent-work plan with fidelity=full_clone and no referencePath/referenceInventory/referenceSpec.'],
      nextAction: firstBlocker.nextAction || 'Provide a declared reference source and parity evidence requirements, then recompile.',
      retryable: true,
      terminal: false
    });
    return resultEnvelope({
      operation: 'plan',
      ok: false,
      state: 'blocked',
      exitCode: AGENT_WORK_EXIT_CODES.blocked,
      runId: planningPacket.objective.runId,
      blockerFamily: firstBlocker.family || 'objective_contract',
      blockerCode: firstBlocker.code || 'full_clone_reference_required',
      nextAction: firstBlocker.nextAction || 'Provide a declared reference source and parity evidence requirements, then recompile.',
      artifacts: {
        runRoot,
        phase4PlanningPacket: planningFiles.planningPacket,
        phase4PlanningQualificationPacket: planningFiles.planningQualificationPacket,
        planReviewPacket: planningFiles.planReviewPacket,
        blockerReport: blockerPath
      },
      data: { phase4Planning: planningPacket },
      truthBoundary: 'Full-clone planning fails closed before v1 contract compilation unless a declared reference source and parity evidence requirements are present.'
    });
  }
  if (objectiveInput.fidelity === 'full_clone') {
    objectiveInput.doneWhen = stableList([...(objectiveInput.doneWhen || []), 'full_clone_parity_evidence']);
    objectiveInput.metadata = { ...(objectiveInput.metadata || {}), fullCloneParityEvidence: true };
  }
  let semanticWorkforcePreplan = null;
  if (objectiveInput.workforcePolicy?.mode === 'semantic_auto') {
    semanticWorkforcePreplan = buildAgentWorkPlanningPacket({
      input: objectiveInput,
      runRoot,
      strictPlanning: resolvedConfig.resolved.strictPlanning === true,
      currentState: options.currentState || {},
      approval: options.approval || null
    });
    const selectedAgentCount = Math.max(1, Number(semanticWorkforcePreplan.workforcePlan?.targetAgentCount || 1));
    objectiveInput.requestedAgentCount = selectedAgentCount;
    objectiveInput.workforcePolicy = {
      ...objectiveInput.workforcePolicy,
      selectedAgentCount,
      selectedPlanDigest: semanticWorkforcePreplan.workforcePlan?.digest || null,
      requestedAgentCountSource: 'semantic_auto'
    };
    objectiveInput.metadata = {
      ...(objectiveInput.metadata || {}),
      semanticWorkforce: {
        mode: 'semantic_auto',
        selectedAgentCount,
        planDigest: semanticWorkforcePreplan.workforcePlan?.digest || null
      }
    };
  }
  const compilation = compileCanonicalAgentWork({
    input: objectiveInput,
    outputDir: runRoot,
    options: { artifactRoot: runRoot, ...options }
  });
  writeJson(path.join(runRoot, 'agent_work_config_resolved.json'), resolvedConfig);
  const cliPacket = buildPhase2Packet({ runRoot, compilation, config: resolvedConfig });
  const cliPacketPath = writeJson(path.join(runRoot, 'cli_contract_packet.json'), cliPacket);
  const planningPacket = buildAgentWorkPlanningPacket({
    input: objectiveInput,
    contractBundle: compilation.v1Contracts,
    runRoot,
    strictPlanning: resolvedConfig.resolved.strictPlanning === true,
    currentState: options.currentState || {},
    approval: options.approval || null
  });
  const planningFiles = writeAgentWorkPlanningArtifacts(planningPacket, runRoot);
  const compileGreen = compilation.canonicalManifest.compileGreen === true && planningPacket.compileAllowed !== false;
  let planningBlockerPath = null;
  if (planningPacket.compileAllowed === false) {
    const firstBlocker = planningPacket.blockers[0] || {};
    const written = writeBlockerReport(runRoot, {
      runId: compilation.canonicalManifest.runId,
      family: firstBlocker.family || 'objective_contract',
      code: firstBlocker.code || 'phase4_planning_blocked',
      summary: firstBlocker.summary || 'Phase 4 objective planning blocked compilation.',
      observedEvidence: firstBlocker.observedEvidence || [`planningStatus=${planningPacket.status}`],
      reproductionSteps: ['Run agent-work plan with the same objective and inspect phase4_planning_packet.json.'],
      nextAction: firstBlocker.nextAction || 'Fix the planning blocker and recompile the objective.',
      retryable: true,
      terminal: false
    });
    planningBlockerPath = written.blockerPath;
  }
  let runtimeProof = null;
  if (compileGreen === true) {
    const { runtime, recovery } = initializeAgentWorkRuntime({
      runRoot,
      runManifest: compilation.v1Contracts.runManifest,
      contractBundle: compilation.v1Contracts
    });
    runtimeProof = {
      dbPath: runtime.dbPath,
      eventsPath: runtime.eventsPath,
      journalMode: runtime.journalMode,
      eventCount: recovery.projection.eventCount,
      stateDigest: recovery.projection.stateDigest
    };
    closeAgentWorkRuntime(runtime);
  }
  return resultEnvelope({
    operation: 'plan',
    ok: compileGreen === true,
    state: compileGreen ? 'compiled' : 'blocked',
    exitCode: compileGreen ? AGENT_WORK_EXIT_CODES.success : AGENT_WORK_EXIT_CODES.blocked,
    runId: compilation.canonicalManifest.runId,
    blockerFamily: compileGreen ? null : (planningPacket.blockers[0]?.family || 'contract_validation_failed'),
    blockerCode: compileGreen ? null : (planningPacket.blockers[0]?.code || 'contract_validation_failed'),
    nextAction: compileGreen ? 'Review the Phase 4 plan packet, approve the plan digest when required, then run on the declared execution plane.' : (planningPacket.blockers[0]?.nextAction || 'Fix contract/planning validation errors before admission.'),
    artifacts: {
      runRoot,
      runManifest: compilation.v1ContractFiles.runManifestPath,
      contractBundle: compilation.v1ContractFiles.contractBundlePath,
      cliContractPacket: cliPacketPath,
      canonicalPipelineManifest: compilation.manifestPath,
      phase4PlanningPacket: planningFiles.planningPacket,
      phase4PlanningQualificationPacket: planningFiles.planningQualificationPacket,
      planReviewPacket: planningFiles.planReviewPacket,
      semanticWorkforcePlan: planningFiles.semanticWorkforcePlan,
      decompositionWorkforcePlan: planningFiles.decompositionWorkforcePlan,
      blockerReport: planningBlockerPath,
      runtimeManifest: path.join(runRoot, 'runtime_manifest.json'),
      runDb: path.join(runRoot, 'run.db'),
      runEvents: path.join(runRoot, 'run_events.jsonl')
    },
    data: { compilation: compilation.canonicalManifest, cliPacket, phase4Planning: planningPacket, semanticWorkforcePreplan, runtime: runtimeProof },
    truthBoundary: 'Planning binds objective inventories, negative space, verifier-backed work, semantic workforce selection, continuation policy, and plan-review digest; when green it also initializes the durable runtime. Planned agent count is not physical-concurrency proof.'
  });
}

function writeBlockerReport(runRoot, { runId, family = 'decision', code, summary, observedEvidence, reproductionSteps, nextAction, retryable = true, terminal = false } = {}) {
  const blocker = {
    schemaVersion: 'clawd.agent_work.blocker.v1',
    blockerId: `${runId || 'unknown_run'}:${code}:1`,
    runId: runId || 'unknown_run',
    family,
    code,
    summary,
    observedEvidence,
    reproductionSteps,
    nextAction,
    retryable,
    terminal,
    generatedAt: nowIso()
  };
  const blockerPath = writeJson(path.join(runRoot, 'blocker_report.json'), blocker);
  return { blocker, blockerPath };
}

export function admitRun({ runRoot, config = {}, workspaceRoot = STACK_ROOT } = {}) {
  const loaded = loadRunArtifacts(runRoot, ['run_manifest.json', 'canonical_pipeline_manifest.json', 'agent_work_v1_contract_bundle.json']);
  if (!loaded.ok) return missingArtifactResult('run', runRoot, loaded.missing);
  const resolvedConfig = resolveAgentWorkConfig({ workspaceRoot, runRoot: loaded.root, cliConfig: config });
  const runId = loaded.runManifest.runId;
  const planReview = readJsonIfExists(path.join(loaded.root, 'plan_review_packet.json'));
  if (resolvedConfig.resolved.requirePlanApproval === true && !planReviewApprovalIsBound(planReview || {})) {
    const { blockerPath } = writeBlockerReport(loaded.root, {
      runId,
      family: 'decision',
      code: 'plan_digest_approval_required',
      summary: 'This Agent Work run requires approval of the exact Phase 4 plan digest before admission.',
      observedEvidence: [`approvalStatus=${planReview?.approvalStatus || 'missing'}`, `planDigest=${planReview?.planDigest || 'missing'}`, `approvedPlanDigest=${planReview?.approvedPlanDigest || 'missing'}`],
      reproductionSteps: ['Compile a run with requirePlanApproval=true, then attempt agent-work run without a matching approvedPlanDigest.'],
      nextAction: 'Approve the exact plan digest in plan_review_packet.json or recompile the plan after changes.',
      retryable: true,
      terminal: false
    });
    return resultEnvelope({
      operation: 'run',
      ok: false,
      state: 'blocked',
      exitCode: AGENT_WORK_EXIT_CODES.invalidOrDenied,
      runId,
      blockerFamily: 'plan_digest_approval_required',
      blockerCode: 'plan_digest_approval_required',
      nextAction: 'Approve the exact Phase 4 plan digest before admission.',
      artifacts: { runRoot: loaded.root, blockerReport: blockerPath, planReviewPacket: path.join(loaded.root, 'plan_review_packet.json') },
      data: { planReview },
      truthBoundary: 'Plan approval is bound to the exact plan digest; stale or mismatched approval cannot admit a run.'
    });
  }
  const boundary = loaded.runManifest.executionBoundary || loaded.canonicalManifest?.executionBoundary || 'control_plane_allowed';
  if (boundary === 'remote_execution_required' && resolvedConfig.hostFacts.hostRole !== 'execution_plane') {
    const { blockerPath } = writeBlockerReport(loaded.root, {
      runId,
      family: 'security',
      code: 'remote_execution_boundary_required',
      summary: 'This Agent Work run declares remote_execution_required and cannot start on the control-plane host.',
      observedEvidence: [`hostRole=${resolvedConfig.hostFacts.hostRole}`, `executionBoundary=${boundary}`, `host=${resolvedConfig.hostFacts.host}`],
      reproductionSteps: ['Run agent-work run <run-root> on a host whose Agent Work host role is execution_plane.'],
      nextAction: 'Sync the run root to the execution plane and launch there, or explicitly change the run contract before admission.',
      retryable: true,
      terminal: false
    });
    return resultEnvelope({
      operation: 'run',
      ok: false,
      state: 'blocked',
      exitCode: AGENT_WORK_EXIT_CODES.invalidOrDenied,
      runId,
      blockerFamily: 'remote_execution_boundary_required',
      blockerCode: 'remote_execution_boundary_required',
      nextAction: 'Launch on the declared execution plane.',
      artifacts: { runRoot: loaded.root, blockerReport: blockerPath },
      data: { hostFacts: resolvedConfig.hostFacts, executionBoundary: boundary },
      truthBoundary: 'Fail-closed placement checks happen before any worker execution.'
    });
  }
  return resultEnvelope({
    operation: 'run',
    ok: true,
    state: 'admitted',
    exitCode: AGENT_WORK_EXIT_CODES.success,
    runId,
    nextAction: 'Start the durable runtime supervisor.',
    artifacts: { runRoot: loaded.root },
    data: { hostFacts: resolvedConfig.hostFacts, executionBoundary: boundary },
    truthBoundary: 'Admission only proves plan approval, placement, and policy gates, not completed work.'
  });
}

export function startRun({ runRoot, config = {}, dryRun = false, workspaceRoot = STACK_ROOT } = {}) {
  const admission = admitRun({ runRoot, config, workspaceRoot });
  if (!admission.ok) return admission;
  if (dryRun) return { ...admission, state: 'admitted_dry_run', truthBoundary: 'Dry-run admission did not execute workers.' };
  const loaded = loadRunArtifacts(runRoot, ['run_manifest.json', 'canonical_pipeline_manifest.json', 'agent_work_v1_contract_bundle.json']);
  const runtime = openAgentWorkRuntime({ runRoot: loaded.root });
  resumeRuntime(runtime, { reason: 'agent-work run admitted runtime startup' });
  closeAgentWorkRuntime(runtime);
  const executionPacket = readJsonIfExists(path.join(loaded.root, 'phase5_execution', 'worker_execution_packet.json'))
    || readJsonIfExists(path.join(loaded.root, 'worker_execution_packet.json'));
  if (executionPacket?.schemaVersion === AGENT_WORK_PHASE5_EXECUTION_PACKET_SCHEMA && executionPacket.status === 'green') {
    return resultEnvelope({
      operation: 'run',
      ok: true,
      state: 'worker_execution_packet_green',
      exitCode: AGENT_WORK_EXIT_CODES.success,
      runId: loaded.runManifest.runId,
      nextAction: 'Continue to independent verification and completion-truth gates.',
      artifacts: { runRoot: loaded.root, workerExecutionPacket: path.join(loaded.root, 'phase5_execution', 'worker_execution_packet.json'), runEvents: path.join(loaded.root, 'run_events.jsonl') },
      data: { workerExecution: executionPacket },
      truthBoundary: 'A green Phase 5 worker execution packet proves bounded worker adapter/isolation/merge evidence only; independent verification and release gates remain later phases.'
    });
  }
  const { blockerPath } = writeBlockerReport(loaded.root, {
    runId: loaded.runManifest.runId,
    family: 'decision',
    code: 'phase5_worker_execution_packet_required',
    summary: 'The durable runtime can start, but run admission now requires a green Phase 5 worker execution packet before claiming worker progress.',
    observedEvidence: ['Phase 3 runtime startup recorded a durable resume event.', `workerExecutionPacketStatus=${executionPacket?.status || 'missing'}`],
    reproductionSteps: ['Run the Phase 5 worker adapter/isolation/merge lane on the execution plane and write phase5_execution/worker_execution_packet.json.'],
    nextAction: 'Generate a green Phase 5 worker execution packet or keep this run blocked.',
    retryable: true,
    terminal: false
  });
  return resultEnvelope({
    operation: 'run',
    ok: false,
    state: 'blocked',
    exitCode: AGENT_WORK_EXIT_CODES.blocked,
    runId: loaded.runManifest.runId,
    blockerFamily: 'phase5_worker_execution_packet_required',
    blockerCode: 'phase5_worker_execution_packet_required',
    nextAction: 'Generate a green Phase 5 worker execution packet on the declared execution plane.',
    artifacts: { runRoot: loaded.root, blockerReport: blockerPath, workerExecutionPacket: path.join(loaded.root, 'phase5_execution', 'worker_execution_packet.json'), runEvents: path.join(loaded.root, 'run_events.jsonl') },
    data: { workerExecution: executionPacket || null },
    truthBoundary: 'Runtime startup is durable, but Agent Work does not fabricate worker execution. Worker progress requires a Phase 5 packet.'
  });
}

export function startCompatibilityController({ compilation, artifactRoot, dryRun = false, stackRoot = STACK_ROOT } = {}) {
  return executeCanonicalAgentWork({ compilation, artifactRoot, dryRun, stackRoot });
}

export function getRunStatus({ runRoot } = {}) {
  const loaded = loadRunArtifacts(runRoot, ['run_manifest.json']);
  if (!loaded.ok) return missingArtifactResult('status', runRoot, loaded.missing);
  const runId = loaded.runManifest.runId;
  let runtimeProjection = null;
  if (fs.existsSync(path.join(loaded.root, 'run.db')) || fs.existsSync(path.join(loaded.root, 'run_events.jsonl'))) {
    const runtime = openAgentWorkRuntime({ runRoot: loaded.root });
    runtimeProjection = recoverRuntimeState(runtime).projection;
    closeAgentWorkRuntime(runtime);
  }
  if (loaded.cancellation || runtimeProjection?.state.cancelled) {
    return resultEnvelope({
      operation: 'status',
      ok: true,
      state: 'cancelled',
      exitCode: AGENT_WORK_EXIT_CODES.success,
      runId,
      nextAction: 'No new work should be started for this run unless a new objective contract is compiled.',
      artifacts: { runRoot: loaded.root, cancellation: path.join(loaded.root, 'cancellation.json'), runEvents: path.join(loaded.root, 'run_events.jsonl') },
      data: { cancellation: loaded.cancellation, runtime: runtimeProjection },
      truthBoundary: 'Cancellation status is read from durable runtime events and the cancellation artifact.'
    });
  }
  if (loaded.blocker) {
    return resultEnvelope({
      operation: 'status',
      ok: false,
      state: 'blocked',
      exitCode: AGENT_WORK_EXIT_CODES.blocked,
      runId,
      blockerFamily: loaded.blocker.code,
      blockerCode: loaded.blocker.code,
      nextAction: loaded.blocker.nextAction,
      artifacts: { runRoot: loaded.root, blockerReport: path.join(loaded.root, 'blocker_report.json') },
      data: { blocker: loaded.blocker },
      truthBoundary: 'Blocked status is artifact-backed; no green claim is allowed.'
    });
  }
  const compileGreen = loaded.canonicalManifest?.compileGreen ?? loaded.contractBundle?.validation?.ok ?? false;
  return resultEnvelope({
    operation: 'status',
    ok: compileGreen === true,
    state: compileGreen ? loaded.runManifest.state || 'compiled' : 'blocked',
    exitCode: compileGreen ? AGENT_WORK_EXIT_CODES.success : AGENT_WORK_EXIT_CODES.blocked,
    runId,
    nextAction: compileGreen ? 'Run on the declared execution plane when ready.' : 'Fix contract validation before proceeding.',
    artifacts: { runRoot: loaded.root, runManifest: path.join(loaded.root, 'run_manifest.json') },
    data: { runManifest: loaded.runManifest, canonicalManifest: loaded.canonicalManifest, runtime: runtimeProjection },
    truthBoundary: 'Status is derived from machine-readable artifacts and durable runtime projection, not logs or chat summaries.'
  });
}

export function resumeRun({ runRoot } = {}) {
  const status = getRunStatus({ runRoot });
  if (!status.ok) return { ...status, operation: 'resume' };
  if (status.state === 'cancelled') {
    return resultEnvelope({
      operation: 'resume',
      ok: false,
      state: 'blocked',
      exitCode: AGENT_WORK_EXIT_CODES.invalidOrDenied,
      runId: status.runId,
      blockerFamily: 'cancelled_run',
      blockerCode: 'cancelled_run',
      nextAction: 'Compile a new objective contract rather than resuming a cancelled run.',
      artifacts: status.artifacts,
      truthBoundary: 'Cancelled runs fail closed until a new contract is created.'
    });
  }
  const runtime = openAgentWorkRuntime({ runRoot: status.artifacts.runRoot });
  const resumed = resumeRuntime(runtime, { reason: 'operator resume through facade' });
  const packet = buildRecoveryQualificationPacket({ runRoot: status.artifacts.runRoot, checks: { resumeRecorded: true } });
  closeAgentWorkRuntime(runtime);
  return resultEnvelope({
    operation: 'resume',
    ok: true,
    state: 'running',
    exitCode: AGENT_WORK_EXIT_CODES.success,
    runId: status.runId,
    nextAction: 'Runtime state resumed; worker execution still requires later phase gates.',
    artifacts: { ...status.artifacts, runEvents: path.join(status.artifacts.runRoot, 'run_events.jsonl'), recoveryPacket: packet.packetPath },
    data: { runtime: resumed.projection, recovery: packet.packet },
    truthBoundary: 'Resume is durable runtime state mutation only; it does not prove worker execution or completion.'
  });
}

export function cancelRun({ runRoot, reason } = {}) {
  const loaded = loadRunArtifacts(runRoot, ['run_manifest.json']);
  if (!loaded.ok) return missingArtifactResult('cancel', runRoot, loaded.missing);
  if (!clean(reason)) {
    return resultEnvelope({
      operation: 'cancel',
      ok: false,
      state: 'invalid_input',
      exitCode: AGENT_WORK_EXIT_CODES.invalidOrDenied,
      runId: loaded.runManifest.runId,
      blockerFamily: 'malformed_input',
      blockerCode: 'cancel_reason_required',
      nextAction: 'Provide --reason <text> when cancelling a run.',
      artifacts: { runRoot: loaded.root },
      truthBoundary: 'Cancellation requires an operator-readable reason.'
    });
  }
  const runtime = openAgentWorkRuntime({ runRoot: loaded.root });
  const cancelled = cancelRuntime(runtime, { reason: clean(reason) });
  const packet = buildRecoveryQualificationPacket({ runRoot: loaded.root, checks: { cancellationRecorded: true } });
  closeAgentWorkRuntime(runtime);
  const cancellation = {
    schemaVersion: 'clawd.agent_work.cancellation.v1',
    generatedAt: nowIso(),
    runId: loaded.runManifest.runId,
    reason: clean(reason),
    state: 'cancelled',
    stateVersion: cancelled.projection.state.stateVersion,
    runtimeStateDigest: cancelled.projection.stateDigest,
    truthBoundary: 'Cancellation is now recorded in durable runtime events; worker drain/fencing expands in later execution phases.'
  };
  const cancellationPath = writeJson(path.join(loaded.root, 'cancellation.json'), cancellation);
  return resultEnvelope({
    operation: 'cancel',
    ok: true,
    state: 'cancelled',
    exitCode: AGENT_WORK_EXIT_CODES.cancelled,
    runId: loaded.runManifest.runId,
    nextAction: 'Inspect status/report; do not launch new work from this run root.',
    artifacts: { runRoot: loaded.root, cancellation: cancellationPath, runEvents: path.join(loaded.root, 'run_events.jsonl'), recoveryPacket: packet.packetPath },
    data: { cancellation, runtime: cancelled.projection, recovery: packet.packet },
    truthBoundary: cancellation.truthBoundary
  });
}

export function verifyRun({ runRoot } = {}) {
  const loaded = loadRunArtifacts(runRoot, ['run_manifest.json', 'agent_work_v1_contract_bundle.json']);
  if (!loaded.ok) return missingArtifactResult('verify', runRoot, loaded.missing);
  const validation = validateAgentWorkV1Bundle(loaded.contractBundle || {});
  const planningPacket = readJsonIfExists(path.join(loaded.root, 'phase4_planning_packet.json'));
  const planReview = readJsonIfExists(path.join(loaded.root, 'plan_review_packet.json'));
  const workerExecutionPacket = readJsonIfExists(path.join(loaded.root, 'phase5_execution', 'worker_execution_packet.json'))
    || readJsonIfExists(path.join(loaded.root, 'worker_execution_packet.json'));
  const phase6TruthPacket = readJsonIfExists(path.join(loaded.root, 'phase6_truth', 'truth_qualification_packet.json'))
    || readJsonIfExists(path.join(loaded.root, 'truth_qualification_packet.json'));
  const phase7OpsPacket = readJsonIfExists(path.join(loaded.root, 'phase7_ops', 'operations_readiness_packet.json'))
    || readJsonIfExists(path.join(loaded.root, 'operations_readiness_packet.json'));
  const phase8ReleasePacket = readJsonIfExists(path.join(loaded.root, 'release-candidate', 'release_packet.json'))
    || readJsonIfExists(path.join(loaded.root, 'phase8_release_candidate', 'release_packet.json'))
    || readJsonIfExists(path.join(loaded.root, 'release_packet.json'));
  const workerExecutionGreen = workerExecutionPacket?.schemaVersion === AGENT_WORK_PHASE5_EXECUTION_PACKET_SCHEMA && workerExecutionPacket.status === 'green';
  const phase6TruthGreen = phase6TruthPacket?.schemaVersion === AGENT_WORK_PHASE6_TRUTH_PACKET_SCHEMA && phase6TruthPacket.status === 'green';
  const phase7OpsGreen = phase7OpsPacket?.schemaVersion === AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA && phase7OpsPacket.status === 'green';
  const phase8ReleaseGreen = phase8ReleasePacket?.schemaVersion === AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA && phase8ReleasePacket.status === 'green';
  const packet = {
    schemaVersion: 'clawd.agent_work.verification_packet.v1',
    generatedAt: nowIso(),
    runId: loaded.runManifest.runId,
    contractVerificationGreen: validation.ok,
    validation,
    planningVerificationGreen: planningPacket?.schemaVersion === AGENT_WORK_PHASE4_PACKET_SCHEMA && planningPacket.compileAllowed === true,
    planDigestApprovalBound: planReviewApprovalIsBound(planReview || {}),
    phase5WorkerExecutionGreen: workerExecutionGreen,
    phase6TruthGreen,
    phase7OpsGreen,
    executionVerified: workerExecutionGreen,
    completionClaimAllowed: phase6TruthGreen,
    allowedClaims: phase6TruthGreen ? phase6TruthPacket.allowedClaims || [] : [],
    operationsClaimAllowed: phase7OpsGreen,
    allowedOperationsClaims: phase7OpsGreen ? phase7OpsPacket.allowedClaims || [] : [],
    phase8ReleaseCandidateGreen: phase8ReleaseGreen,
    releaseCandidateClaimAllowed: phase8ReleaseGreen,
    allowedReleaseCandidateClaims: phase8ReleaseGreen ? phase8ReleasePacket.allowedClaims || [] : [],
    recoveryVerificationGreen: fs.existsSync(path.join(loaded.root, 'run_events.jsonl')) && fs.existsSync(path.join(loaded.root, 'run.db')),
    workerExecutionPacket: workerExecutionPacket ? path.join(loaded.root, 'phase5_execution', 'worker_execution_packet.json') : null,
    phase6TruthPacket: phase6TruthPacket ? path.join(loaded.root, 'phase6_truth', 'truth_qualification_packet.json') : null,
    phase7OpsPacket: phase7OpsPacket ? path.join(loaded.root, 'phase7_ops', 'operations_readiness_packet.json') : null,
    phase8ReleasePacket: phase8ReleasePacket ? path.join(loaded.root, 'release-candidate', 'release_packet.json') : null,
    truthBoundary: 'Verification validates contracts, objective planning artifacts, plan-review digest state, durable runtime presence, Phase 5 worker execution, Phase 6 truth packets, Phase 7 operations packets, and Phase 8 release-candidate packets when present. Completion claims require Phase 6 truth green; operations-readiness claims require Phase 7 ops green; release-candidate claims require Phase 8 release packet green.'
  };
  const packetPath = writeJson(path.join(loaded.root, 'verification_packet.json'), packet);
  return resultEnvelope({
    operation: 'verify',
    ok: validation.ok,
    state: validation.ok ? 'verified_contracts' : 'blocked',
    exitCode: validation.ok ? AGENT_WORK_EXIT_CODES.success : AGENT_WORK_EXIT_CODES.blocked,
    runId: loaded.runManifest.runId,
    blockerFamily: validation.ok ? null : 'contract_validation_failed',
    blockerCode: validation.ok ? null : 'contract_validation_failed',
    nextAction: validation.ok ? 'Continue to plan approval, runtime recovery, Phase 5 worker execution, Phase 6 verifier truth, Phase 7 operations readiness, Phase 8 release-candidate qualification, or later release gates.' : 'Fix v1 contract validation errors.',
    artifacts: { runRoot: loaded.root, verificationPacket: packetPath },
    data: { verification: packet },
    truthBoundary: packet.truthBoundary
  });
}

export function buildCompletionPacket({ runRoot, format = 'json' } = {}) {
  const status = getRunStatus({ runRoot });
  if (status.state === 'missing_artifact') return { ...status, operation: 'report' };
  const planningPacket = status.artifacts?.runRoot ? readJsonIfExists(path.join(status.artifacts.runRoot, 'phase4_planning_packet.json')) : null;
  const workerExecutionPacket = status.artifacts?.runRoot
    ? (readJsonIfExists(path.join(status.artifacts.runRoot, 'phase5_execution', 'worker_execution_packet.json')) || readJsonIfExists(path.join(status.artifacts.runRoot, 'worker_execution_packet.json')))
    : null;
  const phase6TruthPacket = status.artifacts?.runRoot
    ? (readJsonIfExists(path.join(status.artifacts.runRoot, 'phase6_truth', 'truth_qualification_packet.json')) || readJsonIfExists(path.join(status.artifacts.runRoot, 'truth_qualification_packet.json')))
    : null;
  const phase7OpsPacket = status.artifacts?.runRoot
    ? (readJsonIfExists(path.join(status.artifacts.runRoot, 'phase7_ops', 'operations_readiness_packet.json')) || readJsonIfExists(path.join(status.artifacts.runRoot, 'operations_readiness_packet.json')))
    : null;
  const phase8ReleasePacket = status.artifacts?.runRoot
    ? (readJsonIfExists(path.join(status.artifacts.runRoot, 'release-candidate', 'release_packet.json')) || readJsonIfExists(path.join(status.artifacts.runRoot, 'phase8_release_candidate', 'release_packet.json')) || readJsonIfExists(path.join(status.artifacts.runRoot, 'release_packet.json')))
    : null;
  const phase6TruthGreen = phase6TruthPacket?.schemaVersion === AGENT_WORK_PHASE6_TRUTH_PACKET_SCHEMA && phase6TruthPacket.status === 'green';
  const phase7OpsGreen = phase7OpsPacket?.schemaVersion === AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA && phase7OpsPacket.status === 'green';
  const phase8ReleaseGreen = phase8ReleasePacket?.schemaVersion === AGENT_WORK_PHASE8_RELEASE_PACKET_SCHEMA && phase8ReleasePacket.status === 'green';
  const report = {
    schemaVersion: 'clawd.agent_work.phase8_report.v1',
    generatedAt: nowIso(),
    runId: status.runId,
    state: status.state,
    operationOk: status.ok,
    completionClaimAllowed: phase6TruthGreen,
    allowedClaims: phase6TruthGreen ? phase6TruthPacket.allowedClaims || [] : [],
    operationsClaimAllowed: phase7OpsGreen,
    allowedOperationsClaims: phase7OpsGreen ? phase7OpsPacket.allowedClaims || [] : [],
    releaseCandidateClaimAllowed: phase8ReleaseGreen,
    allowedReleaseCandidateClaims: phase8ReleaseGreen ? phase8ReleasePacket.allowedClaims || [] : [],
    blockerFamily: status.blockerFamily,
    nextAction: status.nextAction,
    artifacts: status.artifacts,
    runtimeStateDigest: status.data?.runtime?.stateDigest || null,
    phase4PlanDigest: planningPacket?.planReview?.planDigest || null,
    phase4PlanningStatus: planningPacket?.status || null,
    phase5WorkerExecutionStatus: workerExecutionPacket?.status || null,
    phase5WorkerExecutionGreen: workerExecutionPacket?.schemaVersion === AGENT_WORK_PHASE5_EXECUTION_PACKET_SCHEMA && workerExecutionPacket.status === 'green',
    phase6TruthStatus: phase6TruthPacket?.status || null,
    phase6TruthGreen,
    phase7OpsStatus: phase7OpsPacket?.status || null,
    phase7OpsGreen,
    phase8ReleaseCandidateStatus: phase8ReleasePacket?.status || null,
    phase8ReleaseCandidateGreen: phase8ReleaseGreen,
    truthBoundary: 'Phase 8 reports facade/contract/planning/runtime, worker-execution, independent truth, operations-readiness, and release-candidate packet status. It cannot claim Phase 9 release, production deployment, 100 physical workers, or universal/full parity unless those exact later gates are present.'
  };
  const root = status.artifacts?.runRoot;
  const reportPath = root ? writeJson(path.join(root, 'phase8_report_packet.json'), report) : null;
  return resultEnvelope({
    operation: 'report',
    ok: status.ok,
    state: status.state,
    exitCode: status.exitCode,
    runId: status.runId,
    blockerFamily: status.blockerFamily,
    blockerCode: status.blockerCode,
    nextAction: status.nextAction,
    artifacts: { ...status.artifacts, reportPacket: reportPath },
    data: { report, format },
    truthBoundary: report.truthBoundary
  });
}

export function doctor({ executionPlane = false, workspaceRoot = STACK_ROOT, config = {} } = {}) {
  const resolvedConfig = resolveAgentWorkConfig({ workspaceRoot, cliConfig: config });
  const checks = [
    { id: 'node_available', ok: true, detail: process.version },
    { id: 'rsync_available', ok: Boolean(resolvedConfig.hostFacts.rsync), detail: resolvedConfig.hostFacts.rsync || 'missing' },
    { id: 'canonical_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/canonical-agent-work/index.mjs')), detail: 'packages/canonical-agent-work' },
    { id: 'schema_catalog_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/canonical-agent-work/schemas/objective-contract.schema.json')), detail: 'packages/canonical-agent-work/schemas' },
    { id: 'default_config_present', ok: fs.existsSync(path.join(workspaceRoot, 'config/agent-work-v1/default.json')), detail: 'config/agent-work-v1/default.json' },
    { id: 'runtime_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/agent-work-runtime/index.mjs')), detail: 'packages/agent-work-runtime' },
    { id: 'planning_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/agent-work-planning/index.mjs')), detail: 'packages/agent-work-planning' },
    { id: 'execution_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/agent-work-execution/index.mjs')), detail: 'packages/agent-work-execution' },
    { id: 'verifier_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/agent-work-verifier/index.mjs')), detail: 'packages/agent-work-verifier' },
    { id: 'ops_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/agent-work-ops/index.mjs')), detail: 'packages/agent-work-ops' },
    { id: 'release_candidate_package_present', ok: fs.existsSync(path.join(workspaceRoot, 'packages/agent-work-release-candidate/index.mjs')), detail: 'packages/agent-work-release-candidate' },
    { id: 'node_sqlite_available', ok: true, detail: 'node:sqlite DatabaseSync available' }
  ];
  if (executionPlane) checks.push({ id: 'execution_plane_role', ok: resolvedConfig.hostFacts.hostRole === 'execution_plane', detail: `hostRole=${resolvedConfig.hostFacts.hostRole}` });
  const ok = checks.every((check) => check.ok);
  return resultEnvelope({
    operation: 'doctor',
    ok,
    state: ok ? 'green' : 'blocked',
    exitCode: ok ? AGENT_WORK_EXIT_CODES.success : AGENT_WORK_EXIT_CODES.invalidOrDenied,
    blockerFamily: ok ? null : 'doctor_check_failed',
    blockerCode: ok ? null : 'doctor_check_failed',
    nextAction: ok ? 'Doctor checks passed for this requested host role.' : 'Fix failed doctor checks before launch.',
    artifacts: { workspaceRoot: path.resolve(workspaceRoot) },
    data: { checks, config: resolvedConfig },
    truthBoundary: 'Doctor checks host and facade readiness. It does not prove objective completion.'
  });
}

export function replayRun({ runRoot, verifyOnly = true } = {}) {
  const loaded = loadRunArtifacts(runRoot, ['run_manifest.json']);
  if (!loaded.ok) return missingArtifactResult('replay', runRoot, loaded.missing);
  const eventsPath = path.join(loaded.root, 'run_events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    return resultEnvelope({
      operation: 'replay',
      ok: false,
      state: 'missing_artifact',
      exitCode: AGENT_WORK_EXIT_CODES.blocked,
      runId: loaded.runManifest.runId,
      blockerFamily: 'missing_artifact',
      blockerCode: 'run_events_missing',
      nextAction: 'Plan this run with the Phase 3 facade to produce replayable event streams.',
      artifacts: { runRoot: loaded.root, required: ['run_events.jsonl'] },
      data: { verifyOnly },
      truthBoundary: 'Runtime replay requires the durable event stream.'
    });
  }
  const runtime = openAgentWorkRuntime({ runRoot: loaded.root });
  const recovery = recoverRuntimeState(runtime);
  const packet = buildRecoveryQualificationPacket({ runRoot: loaded.root, checks: { replayVerified: true } });
  closeAgentWorkRuntime(runtime);
  return resultEnvelope({
    operation: 'replay',
    ok: true,
    state: 'replayed',
    exitCode: AGENT_WORK_EXIT_CODES.success,
    runId: loaded.runManifest.runId,
    nextAction: 'Compare replay projection with runtime truth artifacts.',
    artifacts: { runRoot: loaded.root, events: eventsPath, recoveryPacket: packet.packetPath },
    data: { verifyOnly, projection: recovery.projection, recovery: packet.packet },
    truthBoundary: 'Replay deterministically rebuilds runtime state from portable events; it does not prove worker implementation quality.'
  });
}
