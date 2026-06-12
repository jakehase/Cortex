#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAgentWorkRunInput } from '../../packages/agent-work-dsl/index.mjs';
import { buildObjectiveExpansionPlan } from '../../packages/objective-surface-decomposer/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FINITE_RUNNER = path.join(SCRIPT_DIR, 'run-transfer-orchestrator-benchmark.mjs');

function readJson(targetPath, fallback = null) {
  try {
    return fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).flatMap((entry) => {
    if (Array.isArray(entry)) return entry;
    return String(entry ?? '').split(/,|\n/);
  }).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function normalizePolicyKey(key = '') {
  return String(key || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[.-]/g, '_');
}

function policyNumber(policy = {}, keys = [], fallback = null) {
  const normalized = new Map(Object.entries(policy || {}).map(([key, value]) => [normalizePolicyKey(key), value]));
  for (const key of keys.map(normalizePolicyKey)) {
    const parsed = Number(normalized.get(key));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

function parseArgs(argv) {
  const args = { inputPath: null, artifactRoot: null, maxWaves: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (!args.inputPath && !token.startsWith('--')) { args.inputPath = path.resolve(token); continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
  }
  if (!args.inputPath) {
    console.error('usage: node run-agent-work-objective-controller.mjs <run_contract.json|agent_work_spec.aw|agent_work_spec.json|compiled-agent-work-dir> [--artifact-root ROOT] [--max-waves N] [--dry-run]');
    process.exit(2);
  }
  return args;
}

function findWaveFactpackPath(waveRoot) {
  const candidates = [
    path.join(waveRoot, 'wave_factpack.json'),
    path.join(waveRoot, 'orchestrator_run', 'wave_factpack.json')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function completedIdsFromMatrix(matrix = {}) {
  return stableList((matrix?.surfaces || [])
    .filter((surface) => ['verified', 'complete', 'completed', 'green'].includes(String(surface.status || '').trim()))
    .flatMap((surface) => [surface.id, surface.focusId, surface.architectureEpicId, ...(Array.isArray(surface.issueIds) ? surface.issueIds : [])]));
}

function graphExhaustedFromWave({ workerEvents = [], matrix = {}, waveBlocker = null, policyReport = null } = {}) {
  if ((workerEvents || []).some((event) => event.type === 'no_schedulable_work_remaining')) return true;
  if (['orchestrator_green', 'all_complete', 'blocked'].includes(String(matrix?.status || '').trim())) return true;
  if (['insufficient_parallel_surface_inventory', 'benchmark_thresholds_unmet'].includes(String(waveBlocker?.blockerFamily || ''))) return true;
  return isExpandableEvidenceSchemaGap({ waveBlocker, policyReport });
}

function shouldTriggerExpansion({ triggers = [], objectiveRed, graphExhausted }) {
  const normalized = triggers.map(normalizePolicyKey);
  return (normalized.includes('objective_red') && objectiveRed) || (normalized.includes('graph_exhausted') && graphExhausted);
}

function isExpandableEvidenceSchemaGap({ waveBlocker = null, policyReport = null } = {}) {
  if (!waveBlocker || waveBlocker.unsupportedPolicy === true) return false;
  if (waveBlocker.blockerFamily !== 'agent_work_policy_violation') return false;
  const violations = policyReport?.blockingViolations || waveBlocker.policyReport?.blockingViolations || waveBlocker.policyViolations || [];
  return violations.length > 0 && violations.every((violation) => violation.policy === 'evidenceSchemas');
}

function expansionAllowedForWave({ completion = null, waveBlocker = null, policyReport = null } = {}) {
  if (!completion || completion.thresholdPass === true) return { ok: false, reason: 'wave_not_red' };
  if (!waveBlocker) return { ok: true, reason: 'objective_red_without_specific_blocker' };
  if (waveBlocker.unsupportedPolicy === true) return { ok: false, reason: 'unsupported_policy_blocker' };
  const blockerFamily = String(waveBlocker.blockerFamily || '');
  if (['insufficient_parallel_surface_inventory', 'benchmark_thresholds_unmet', 'unproductive_scale_credit'].includes(blockerFamily)) return { ok: true, reason: blockerFamily };
  if (isExpandableEvidenceSchemaGap({ waveBlocker, policyReport })) return { ok: true, reason: 'evidence_schema_objective_gap' };
  if (blockerFamily === 'agent_work_policy_violation') return { ok: false, reason: 'non_expandable_policy_violation' };
  if (blockerFamily === 'orchestrator_failure') return { ok: false, reason: 'orchestrator_failure_not_objective_gap' };
  return { ok: false, reason: `non_expandable_blocker:${blockerFamily || 'unknown'}` };
}

function contractObjective(contract = {}) {
  const language = contract.scope?.agentWorkLanguage || {};
  return {
    id: language.goalId || contract.goalId || contract.benchmarkId || 'agent_work_objective',
    title: language.outcome || contract.outcome || contract.notes || contract.benchmarkId || 'Agent Work objective',
    requestedFidelity: contract.fidelity || 'production_slice',
    requestedAgentCount: contract.requestedAgentCount || null
  };
}

function makeWaveContract({ contract, controllerRunId, waveNumber, waveRoot, surfaces, previousWaveFactpackPath, expansionPolicy }) {
  const waveContract = clone(contract);
  const waveId = `wave-${String(waveNumber).padStart(3, '0')}`;
  waveContract.runId = `${contract.runId || contract.benchmarkId || 'agent-work'}-${waveId}`;
  waveContract.artifactRoot = waveRoot;
  waveContract.scoreboardPath = path.join(path.dirname(path.dirname(waveRoot)), 'scoreboard.json');
  waveContract.scope = {
    ...(waveContract.scope || {}),
    surfaces: surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label || surface.id,
      allowedFiles: stableList(surface.allowedFiles || surface.productFiles || surface.targetFiles || surface.fileAreas),
      verification: stableList(surface.verification || surface.verify || surface.verifiers),
      productGoal: surface.productGoal || surface.goal || `Advance ${surface.label || surface.id}`,
      metadata: {
        ...(surface.metadata || {}),
        objectiveControllerWave: waveNumber,
        controllerRunId,
        sourceExpansionIndex: surface.expansionIndex ?? null
      }
    })),
    expansionPolicy: {},
    contextGovernor: {
      ...(waveContract.scope?.contextGovernor || {}),
      ...(previousWaveFactpackPath ? { previousWaveFactpackPath } : {})
    }
  };
  waveContract.metadata = {
    ...(waveContract.metadata || {}),
    agentWorkObjectiveController: {
      schemaVersion: 'claw.agent_work_objective_controller.v0',
      controllerRunId,
      waveNumber,
      originalRunId: contract.runId || null,
      expansionPolicyManagedByController: expansionPolicy || {}
    }
  };
  return waveContract;
}

function writeControllerBlocker({ artifactRoot, contract, blocker, waves = [], expansions = [] }) {
  const report = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'agent_work_objective_controller',
    status: 'blocked',
    ...blocker
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), report);
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: report.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    executionMode: 'agent_work_objective_controller',
    thresholdPass: false,
    mechanicalGreen: waves.some((wave) => wave.completion?.mechanicalGreen === true),
    scaleProofReady: waves.some((wave) => wave.completion?.scaleProofReady === true),
    waveCount: waves.length,
    expansionCount: expansions.length,
    blocker: report,
    note: report.blocker
  });
  return report;
}

function runWave({ waveContractPath, dryRun = false }) {
  if (dryRun) return { status: 0, stdout: JSON.stringify({ dryRun: true }), stderr: '' };
  return spawnSync(process.execPath, [FINITE_RUNNER, waveContractPath], {
    cwd: path.resolve(path.join(SCRIPT_DIR, '../..')),
    encoding: 'utf8',
    env: process.env
  });
}

const args = parseArgs(process.argv.slice(2));
let resolvedRunInput;
try {
  resolvedRunInput = resolveAgentWorkRunInput(args.inputPath);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: 'agent_work_run_input_unreadable', message: error?.message || String(error), inputPath: args.inputPath }, null, 2));
  process.exit(2);
}

const contract = resolvedRunInput.runContract;
const artifactRoot = path.resolve(args.artifactRoot || contract.artifactRoot);
const controllerRunId = `${contract.runId || contract.benchmarkId || 'agent-work'}-objective-controller`;
const expansionPolicy = contract.scope?.expansionPolicy || {};
const wavePolicy = contract.scope?.wavePolicy || {};
const expansionTriggers = stableList(expansionPolicy.triggers || expansionPolicy.trigger || expansionPolicy.when);
const maxWaves = Math.max(1, Number(args.maxWaves || policyNumber(wavePolicy, ['max_waves', 'maxWaves'], null) || policyNumber(expansionPolicy, ['max_cycles', 'maxCycles'], null) || 3));
const maxCycles = Math.max(0, Number(policyNumber(expansionPolicy, ['max_cycles', 'maxCycles'], maxWaves) ?? maxWaves));
const maxSurfaces = Math.max(1, Number(policyNumber(expansionPolicy, ['max_surfaces', 'maxSurfaces'], 200) || 200));
const objective = contractObjective(contract);

fs.mkdirSync(artifactRoot, { recursive: true });
writeJson(path.join(artifactRoot, 'controller_input_resolution.json'), {
  schemaVersion: 'claw.agent_work_objective_controller_input.v0',
  generatedAt: new Date().toISOString(),
  inputPath: args.inputPath,
  runContractPath: resolvedRunInput.runContractPath,
  compiledFromAgentWorkDsl: resolvedRunInput.compiledFromAgentWorkDsl === true,
  runtime: resolvedRunInput.runtime || null,
  controllerRunId,
  originalRunId: contract.runId || null
});
writeJson(path.join(artifactRoot, 'controller_policy.json'), {
  schemaVersion: 'claw.agent_work_objective_controller_policy.v0',
  generatedAt: new Date().toISOString(),
  expansionPolicy,
  wavePolicy,
  maxWaves,
  maxCycles,
  maxSurfaces,
  expansionTriggers,
  truthBoundary: 'The controller may launch additional finite transfer-runner waves when the objective remains red and the current scoped graph is exhausted. It does not itself implement product parity; it reports final threshold truth from wave artifacts.'
});

let selectedSurfaces = contract.scope?.surfaces || [];
let previousWaveFactpackPath = null;
let completedSurfaceIds = [];
const waves = [];
const expansions = [];
let finalStatus = 'blocked';
let finalCompletion = null;
let blocker = null;

for (let waveNumber = 1; waveNumber <= maxWaves; waveNumber += 1) {
  if (!Array.isArray(selectedSurfaces) || selectedSurfaces.length === 0) {
    blocker = {
      blockerFamily: 'objective_expansion_empty_wave',
      blocker: 'Agent Work objective controller has no surfaces to launch for the next wave.',
      nextAction: 'Provide initial surfaces or repair objective decomposition so it returns executable surfaces.'
    };
    break;
  }

  const waveRoot = path.join(artifactRoot, 'waves', `wave-${String(waveNumber).padStart(3, '0')}`);
  const waveContract = makeWaveContract({ contract, controllerRunId, waveNumber, waveRoot, surfaces: selectedSurfaces, previousWaveFactpackPath, expansionPolicy });
  const waveContractPath = path.join(waveRoot, 'run_contract.json');
  writeJson(waveContractPath, waveContract);

  const run = runWave({ waveContractPath, dryRun: args.dryRun });
  const completion = readJson(path.join(waveRoot, 'completion_summary.json'), null);
  const threshold = readJson(path.join(waveRoot, 'threshold_evaluation.json'), null);
  const matrix = readJson(path.join(waveRoot, 'surface_matrix.json'), null);
  const policyReport = readJson(path.join(waveRoot, 'agent_work_policy_report.json'), null);
  const waveBlocker = readJson(path.join(waveRoot, 'blocker_report.json'), null);
  const workerEvents = readJson(path.join(waveRoot, 'orchestrator_run', 'worker_events.json'), []);
  const waveFactpackPath = findWaveFactpackPath(waveRoot);
  const waveRecord = {
    waveNumber,
    waveRoot,
    waveContractPath,
    exitCode: run.status,
    thresholdPass: completion?.thresholdPass === true,
    mechanicalGreen: completion?.mechanicalGreen === true,
    scaleProofReady: completion?.scaleProofReady === true,
    surfaceCount: selectedSurfaces.length,
    completedSurfaceIds: completedIdsFromMatrix(matrix),
    waveFactpackPath,
    completion,
    threshold,
    agentWorkPolicy: policyReport,
    blocker: waveBlocker,
    stdoutTail: String(run.stdout || '').split('\n').slice(-20).join('\n'),
    stderrTail: String(run.stderr || '').split('\n').slice(-20).join('\n')
  };
  waves.push(waveRecord);
  completedSurfaceIds = stableList([...completedSurfaceIds, ...waveRecord.completedSurfaceIds]);
  previousWaveFactpackPath = waveFactpackPath;
  writeJson(path.join(artifactRoot, 'objective_controller_state.json'), {
    schemaVersion: 'claw.agent_work_objective_controller_state.v0',
    generatedAt: new Date().toISOString(),
    controllerRunId,
    status: 'running',
    waves: waves.map((wave) => ({
      waveNumber: wave.waveNumber,
      waveRoot: wave.waveRoot,
      exitCode: wave.exitCode,
      thresholdPass: wave.thresholdPass,
      mechanicalGreen: wave.mechanicalGreen,
      scaleProofReady: wave.scaleProofReady,
      surfaceCount: wave.surfaceCount,
      completedSurfaceIds: wave.completedSurfaceIds,
      waveFactpackPath: wave.waveFactpackPath,
      blockerFamily: wave.blocker?.blockerFamily || null
    })),
    expansions
  });

  if (!completion) {
    blocker = {
      blockerFamily: 'wave_artifacts_missing',
      blocker: 'Finite transfer runner did not write completion_summary.json for a controller wave.',
      nextAction: 'Inspect the wave stdout/stderr and repair the finite runner crash before launching more waves.',
      waveNumber,
      exitCode: run.status
    };
    break;
  }

  if (completion.thresholdPass === true) {
    finalStatus = 'passed';
    finalCompletion = completion;
    break;
  }

  const objectiveRed = completion.thresholdPass !== true;
  const graphExhausted = graphExhaustedFromWave({ workerEvents, matrix, waveBlocker, policyReport });
  const expansionTriggered = shouldTriggerExpansion({ triggers: expansionTriggers, objectiveRed, graphExhausted });
  const expansionAllowed = expansionAllowedForWave({ completion, waveBlocker, policyReport });
  if (!expansionTriggered || !expansionAllowed.ok) {
    blocker = {
      blockerFamily: expansionTriggered ? 'objective_red_not_expandable' : 'objective_red_without_expansion_trigger',
      blocker: expansionTriggered
        ? 'The wave ended red, but the blocker is not an objective-surface gap that can honestly be repaired by launching another wave.'
        : 'The wave ended red, but the Agent Work expansion policy did not trigger another wave.',
      nextAction: expansionTriggered
        ? 'Repair the latest wave blocker directly, then relaunch the objective controller.'
        : 'Add objective_red or graph_exhausted to expansionPolicy.triggers, or repair the current wave blocker directly.',
      waveNumber,
      objectiveRed,
      graphExhausted,
      expansionTriggers,
      expansionAllowedReason: expansionAllowed.reason,
      waveBlockerFamily: waveBlocker?.blockerFamily || null
    };
    break;
  }

  if (expansions.length >= maxCycles || waveNumber >= maxWaves) {
    blocker = {
      blockerFamily: 'objective_expansion_budget_exhausted',
      blocker: 'The objective is still red, but the Agent Work multi-wave expansion budget is exhausted.',
      nextAction: 'Increase wavePolicy.max_waves / expansionPolicy.max_cycles, lower the objective scope, or inspect the latest wave blocker.',
      waveNumber,
      maxWaves,
      maxCycles,
      objectiveRed,
      graphExhausted
    };
    break;
  }

  const expansionPlan = buildObjectiveExpansionPlan({
    repoPath: contract.repoPath,
    objective,
    requestedAgentCount: contract.requestedAgentCount,
    maxSurfaces,
    currentSurfaceMatrix: matrix,
    currentWorkCount: 0,
    scopeAlreadySatisfied: graphExhausted,
    supervisorState: {
      status: readJson(path.join(waveRoot, 'supervisor_status.json'), {})?.supervisorStatus || null,
      matrixStatus: matrix?.status || null,
      requestedFidelity: contract.fidelity,
      blockerKind: waveBlocker?.blockerFamily || waveBlocker?.blockerKind || null
    },
    completedSurfaceIds,
    expansionIndex: expansions.length + 1
  });
  const expansionRoot = path.join(artifactRoot, 'expansions', `expansion-${String(expansions.length + 1).padStart(3, '0')}`);
  writeJson(path.join(expansionRoot, 'objective_expansion_plan.json'), expansionPlan);
  writeJson(path.join(expansionRoot, 'surface_matrix.json'), expansionPlan.surfaceMatrix);
  writeJson(path.join(expansionRoot, 'work_graph.json'), expansionPlan.workGraph);
  expansions.push({
    expansionIndex: expansions.length + 1,
    expansionRoot,
    shouldExpand: expansionPlan.shouldExpand,
    reason: expansionPlan.reason,
    expansionSurfaceCount: expansionPlan.expansionSurfaceCount,
    expansionWorkUnitCount: expansionPlan.expansionWorkUnitCount,
    remainingObjectiveIds: expansionPlan.remainingObjectiveIds || []
  });

  if (!expansionPlan.shouldExpand || !Array.isArray(expansionPlan.surfaceMatrix?.surfaces) || expansionPlan.surfaceMatrix.surfaces.length === 0) {
    blocker = {
      blockerFamily: 'objective_expansion_unavailable',
      blocker: 'The objective is still red and expansion was triggered, but the decomposer found no executable remaining surfaces.',
      nextAction: 'Inspect the objective expansion plan, add executable product surfaces/tests, or mark the objective as blocked rather than complete.',
      waveNumber,
      expansionReason: expansionPlan.reason,
      expansionRoot,
      decompositionBlocker: expansionPlan.blocker || null
    };
    break;
  }

  selectedSurfaces = expansionPlan.surfaceMatrix.surfaces;
}

const summary = {
  schemaVersion: 'claw.agent_work_objective_controller_summary.v0',
  generatedAt: new Date().toISOString(),
  controllerRunId,
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  status: finalStatus,
  thresholdPass: finalStatus === 'passed',
  waveCount: waves.length,
  expansionCount: expansions.length,
  maxWaves,
  maxCycles,
  completedSurfaceIds,
  finalWave: waves.at(-1) ? {
    waveNumber: waves.at(-1).waveNumber,
    waveRoot: waves.at(-1).waveRoot,
    thresholdPass: waves.at(-1).thresholdPass,
    mechanicalGreen: waves.at(-1).mechanicalGreen,
    scaleProofReady: waves.at(-1).scaleProofReady,
    blockerFamily: waves.at(-1).blocker?.blockerFamily || null
  } : null,
  expansions,
  blocker,
  truthBoundary: 'Multi-wave objective control is proven only by wave artifacts and thresholdPass. Expansion waves are planning/control-plane work; they are not product parity claims by themselves.'
};
writeJson(path.join(artifactRoot, 'objective_controller_summary.json'), summary);
writeJson(path.join(artifactRoot, 'objective_controller_state.json'), { ...summary, waves });

if (finalStatus === 'passed') {
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: summary.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    executionMode: 'agent_work_objective_controller',
    thresholdPass: true,
    supervisorConfirmedCompletion: finalCompletion?.supervisorConfirmedCompletion === true,
    mechanicalGreen: finalCompletion?.mechanicalGreen === true,
    scaleProofReady: finalCompletion?.scaleProofReady === true,
    waveCount: waves.length,
    expansionCount: expansions.length,
    finalWaveRoot: waves.at(-1)?.waveRoot || null,
    finalWaveCompletion: finalCompletion,
    note: 'Agent Work objective controller reached a threshold-passing wave.'
  });
  console.log(JSON.stringify({ ok: true, thresholdPass: true, artifactRoot, waveCount: waves.length, expansionCount: expansions.length, finalWaveRoot: waves.at(-1)?.waveRoot || null }, null, 2));
  process.exit(0);
}

const blockerReport = writeControllerBlocker({
  artifactRoot,
  contract,
  blocker: blocker || {
    blockerFamily: 'objective_controller_stopped_without_threshold_pass',
    blocker: 'Agent Work objective controller stopped without reaching a threshold-passing wave.',
    nextAction: 'Inspect objective_controller_state.json and the latest wave blocker before relaunching.'
  },
  waves,
  expansions
});
console.log(JSON.stringify({ ok: false, thresholdPass: false, artifactRoot, waveCount: waves.length, expansionCount: expansions.length, blocker: blockerReport }, null, 2));
process.exit(1);
