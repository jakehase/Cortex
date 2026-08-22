#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildStrictInventoryReduction } from './mailchimp-strict-inventory-reducer.mjs';
import { deriveAutonomousIterationDecision } from '../../packages/orchestration-autonomy/index.mjs';
import { reduceRunState } from '../../packages/orchestrator-run-state/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));
const DEFAULT_RUNNER_SCRIPT = path.join(SCRIPT_DIR, 'run-mailchimp-autonomous-continuation.mjs');
const DEFAULT_QUEUE_EXPANDER_SCRIPT = path.join(SCRIPT_DIR, 'run-mailchimp-continuous-queue-expander.mjs');
const DEFAULT_BENCHMARK_ID = 'mailchimp_autonomous_strict_gap_autopilot';

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-').replace('Z', '');
}

function parseArgs(argv) {
  const args = {
    benchmarkId: DEFAULT_BENCHMARK_ID,
    stackRoot: DEFAULT_STACK_ROOT,
    mailchimpRoot: DEFAULT_MAILCHIMP_ROOT,
    runnerScript: DEFAULT_RUNNER_SCRIPT,
    queueExpanderScript: DEFAULT_QUEUE_EXPANDER_SCRIPT,
    seedArtifactRoot: null,
    artifactRoot: null,
    maxIterations: 10,
    stopOnUnsupported: true,
    skipTests: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--runner-script') { args.runnerScript = path.resolve(next); index += 1; continue; }
    if (token === '--queue-expander-script') { args.queueExpanderScript = path.resolve(next); index += 1; continue; }
    if (token === '--no-queue-expander') { args.queueExpanderScript = null; continue; }
    if (token === '--seed-artifact-root' || token === '--anchor-artifact-root') { args.seedArtifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--max-iterations') { args.maxIterations = Math.max(1, Number(next || 1)); index += 1; continue; }
    if (token === '--skip-tests') { args.skipTests = true; continue; }
    if (token === '--no-stop-on-unsupported') { args.stopOnUnsupported = false; continue; }
  }
  if (!args.seedArtifactRoot) throw new Error('Missing --seed-artifact-root');
  if (!args.artifactRoot) args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks', args.benchmarkId, `autopilot-${stamp()}`);
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slugify(value = '') {
  return String(value || 'gap').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'gap';
}

function strictGapForQueueEntry(entry = {}, supportedSurfaces = []) {
  if (entry.strictGap) return entry.strictGap;
  const candidateIds = [
    entry.globalGapId,
    entry.parentSurfaceId,
    entry.surfaceId,
    String(entry.id || '').replace(/__req_\d+$/, ''),
    String(entry.leafId || '').replace(/__req_\d+$/, '')
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const exact = supportedSurfaces.find((surface) => candidateIds.some((id) => id === surface.globalGapId || id === surface.id || id === surface.parentSurfaceId));
  if (exact?.strictGap) return exact.strictGap;
  const entryFiles = new Set(Array.isArray(entry.allowedFiles) ? entry.allowedFiles : Array.isArray(entry.productFiles) ? entry.productFiles : []);
  const entryTests = new Set(Array.isArray(entry.targetedTests) ? entry.targetedTests : []);
  const overlap = supportedSurfaces
    .map((surface) => {
      const fileOverlap = (surface.productFiles || []).filter((file) => entryFiles.has(file)).length;
      const testOverlap = (surface.targetedTests || []).filter((test) => entryTests.has(test)).length;
      return { surface, score: fileOverlap * 2 + testOverlap };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  return overlap?.surface?.strictGap || null;
}

function firstQueuedGap(artifactRoot, supportedSurfaces = []) {
  const queue = readJson(path.join(artifactRoot, 'next_work_queue.json'), {});
  const work = Array.isArray(queue.work) ? queue.work : [];
  return work.map((entry) => strictGapForQueueEntry(entry, supportedSurfaces)).find(Boolean) || null;
}

function artifactSummary(artifactRoot) {
  return readJson(path.join(artifactRoot, 'completion_summary.json'), {}) || {};
}

function artifactPresence(artifactRoot) {
  return {
    completionSummary: fs.existsSync(path.join(artifactRoot, 'completion_summary.json')),
    thresholdEvaluation: fs.existsSync(path.join(artifactRoot, 'threshold_evaluation.json')),
    runStateTruth: fs.existsSync(path.join(artifactRoot, 'run_state_truth.json')),
    blockerReport: fs.existsSync(path.join(artifactRoot, 'blocker_report.json'))
  };
}

function readPatchQueue(artifactRoot) {
  return readJson(path.join(artifactRoot, 'orchestrator_run', 'patch_queue.json'), null)
    || readJson(path.join(artifactRoot, 'patch_queue.json'), null)
    || readJson(path.join(artifactRoot, 'delegate', 'orchestrator_run', 'patch_queue.json'), null)
    || {};
}

function readProofMapFromSummary(summary = {}, artifactRoot = null) {
  const candidates = [
    summary.proofMapPath,
    summary.phase9ProofMapPath,
    summary.proofMap?.path,
    artifactRoot ? path.join(artifactRoot, 'phase9-proof-map.json') : null,
    artifactRoot ? path.join(artifactRoot, 'proof-map.json') : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    const proofPath = path.isAbsolute(candidate) ? candidate : path.join(artifactRoot || '.', candidate);
    const proofMap = readJson(proofPath, null);
    if (proofMap) return proofMap;
  }
  return null;
}

function autonomyDecisionForIteration(result, options = {}) {
  const artifactRoot = result.artifactRoot;
  const summary = result.summary || artifactSummary(artifactRoot);
  const thresholdEvaluation = readJson(path.join(artifactRoot, 'threshold_evaluation.json'), {}) || {};
  const blockerReport = readJson(path.join(artifactRoot, 'blocker_report.json'), null);
  const nextWorkQueue = readJson(path.join(artifactRoot, 'next_work_queue.json'), {}) || {};
  const preflightSummary = summary.phase9 || summary.phase9Preflight || summary.realParityPreflight || summary;
  return deriveAutonomousIterationDecision({
    generatedAt: new Date().toISOString(),
    requestedFidelity: summary.fidelity || 'production_slice',
    completionSummary: summary,
    thresholdEvaluation,
    blockerReport,
    nextWorkQueue,
    patchQueue: readPatchQueue(artifactRoot),
    proofMap: readProofMapFromSummary(summary, artifactRoot),
    preflightSummary,
    testExitCodes: summary.testExitCodes || {},
    artifacts: artifactPresence(artifactRoot),
    requiredArtifactKeys: options.seedPreflight ? ['completionSummary', 'thresholdEvaluation'] : undefined,
    requireBlockerWhenRed: false,
    maxAssignments: 1,
    zeroDiffObserved: summary.honestyGate?.claimIntegrityKind === 'zero_modified_files'
      || summary.claimIntegrityKind === 'zero_modified_files'
      || summary.blocker?.blockerKind === 'zero_modified_files'
      || /zero[_ -]?modified[_ -]?files/i.test(JSON.stringify(summary.blocker || {}))
  });
}

function loadSupportedCatalog(args) {
  const result = spawnSync(process.execPath, [args.runnerScript, '--list-supported-gaps-json', '--stack-root', args.stackRoot, '--mailchimp-root', args.mailchimpRoot], {
    cwd: args.stackRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Unable to read supported gaps from continuation runner: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  const payload = JSON.parse(result.stdout || '{}');
  return {
    supportedSurfaces: Array.isArray(payload.supportedSurfaces) ? payload.supportedSurfaces : [],
    fallbackRemainingStrictGaps: Array.isArray(payload.fallbackRemainingStrictGaps) ? payload.fallbackRemainingStrictGaps : []
  };
}

function expandedFallbackGapAfter(anchorSummary, fallbackRemainingStrictGaps, supportedGapSet) {
  if (!fallbackRemainingStrictGaps.length) return null;
  const references = [
    anchorSummary.selectedStrictGap,
    ...(Array.isArray(anchorSummary.iterations) ? anchorSummary.iterations.map((entry) => entry.selectedStrictGap) : [])
  ].filter(Boolean);
  const lastReference = references.at(-1) || null;
  const referenceIndex = lastReference ? fallbackRemainingStrictGaps.findIndex((gap) => gap === lastReference) : -1;
  const candidates = referenceIndex >= 0 ? fallbackRemainingStrictGaps.slice(referenceIndex + 1) : fallbackRemainingStrictGaps;
  return candidates.find((gap) => supportedGapSet.has(gap) && !references.includes(gap)) || null;
}

function runQueueExpansion(args, currentAnchor, iterationNumber) {
  if (!args.queueExpanderScript) return { ok: false, disabled: true, strictGap: null, work: [] };
  const artifactRoot = path.join(args.artifactRoot, 'queue_expansions', `expand-${String(iterationNumber).padStart(3, '0')}`);
  const commandArgs = [
    args.queueExpanderScript,
    '--stack-root', args.stackRoot,
    '--mailchimp-root', args.mailchimpRoot,
    '--runner-script', args.runnerScript,
    '--anchor-artifact-root', currentAnchor,
    '--artifact-root', artifactRoot
  ];
  const result = spawnSync(process.execPath, commandArgs, { cwd: args.stackRoot, encoding: 'utf8' });
  const summary = artifactSummary(artifactRoot);
  const queue = readJson(path.join(artifactRoot, 'next_work_queue.json'), { work: [] }) || { work: [] };
  const work = Array.isArray(queue.work) ? queue.work : [];
  const strictGap = work.find((entry) => entry?.strictGap)?.strictGap || summary.selectedStrictGap || null;
  return {
    ok: result.status === 0 && Boolean(strictGap),
    artifactRoot,
    command: `${process.execPath} ${commandArgs.join(' ')}`,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    summary,
    work,
    strictGap,
    supportedByContinuationRunner: work.find((entry) => entry?.strictGap === strictGap)?.supportedByContinuationRunner ?? summary.selectedSupportedByContinuationRunner ?? null,
    blocker: summary.blocker || null
  };
}

function buildBlocker(kind, message, extra = {}) {
  return {
    blockerKind: kind,
    message,
    retryable: false,
    nextAction: extra.nextAction || 'Inspect blocker_report.json and extend the continuation runner or fix the failing artifact before relaunching autopilot.',
    ...extra
  };
}

function summaryHasGlobalFullCloneProof(summary = {}) {
  const parityStatus = String(summary?.parityStatus || '').trim();
  return summary?.globalFullClonePass === true
    || summary?.fullClonePass === true
    || parityStatus === 'full'
    || parityStatus === 'full_clone';
}

function observedGlobalFullClonePass(args, currentAnchor, iterations = []) {
  const summaries = [
    artifactSummary(args.seedArtifactRoot),
    currentAnchor ? artifactSummary(currentAnchor) : null,
    ...iterations.map((entry) => entry?.summary || (entry?.artifactRoot ? artifactSummary(entry.artifactRoot) : null))
  ].filter(Boolean);
  return summaries.some(summaryHasGlobalFullCloneProof);
}

function writeState(args, state) {
  writeJson(path.join(args.artifactRoot, 'autopilot_state.json'), state);
  writeJson(path.join(args.artifactRoot, 'loop_events.json'), { generatedAt: new Date().toISOString(), events: state.events });
}

function runContinuationIteration(args, currentAnchor, iterationNumber, strictGap) {
  const iterationId = `iter-${String(iterationNumber).padStart(3, '0')}-${slugify(strictGap)}`;
  const artifactRoot = path.join(args.artifactRoot, 'iterations', iterationId);
  const commandArgs = [
    args.runnerScript,
    '--mailchimp-root', args.mailchimpRoot,
    '--phase13-artifact-root', currentAnchor,
    '--artifact-root', artifactRoot,
    '--apply'
  ];
  if (args.skipTests) commandArgs.push('--skip-tests');
  const result = spawnSync(process.execPath, commandArgs, { cwd: args.stackRoot, encoding: 'utf8' });
  const summary = artifactSummary(artifactRoot);
  return {
    iterationId,
    artifactRoot,
    command: `${process.execPath} ${commandArgs.join(' ')}`,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    summary,
    nextStrictGap: summary.nextStrictGap || firstQueuedGap(artifactRoot),
    thresholdPass: summary.thresholdPass === true,
    supervisorStatus: summary.supervisorStatus || null,
    selectedStrictGap: summary.selectedStrictGap || strictGap,
    selectedSurfaceId: summary.selectedSurfaceId || null,
    testsPassed: summary.testsPassed === true,
    honestyOk: summary.honestyGate?.ok === true,
    blocker: summary.blocker || null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.artifactRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const supportedCatalog = loadSupportedCatalog(args);
  const supportedSurfaces = supportedCatalog.supportedSurfaces;
  const supportedGapSet = new Set(supportedSurfaces.map((entry) => entry.strictGap).filter(Boolean));
  const events = [{ type: 'autopilot_started', generatedAt: startedAt, seedArtifactRoot: args.seedArtifactRoot, maxIterations: args.maxIterations }];
  const iterations = [];
  const state = {
    schemaVersion: 'clawd.mailchimp.autonomous_continuation_autopilot.v1',
    generatedAt: startedAt,
    benchmarkId: args.benchmarkId,
    artifactRoot: args.artifactRoot,
    seedArtifactRoot: args.seedArtifactRoot,
    currentAnchorArtifactRoot: args.seedArtifactRoot,
    maxIterations: args.maxIterations,
    supportedSurfaces,
    fallbackRemainingStrictGaps: supportedCatalog.fallbackRemainingStrictGaps,
    queueExpanderScript: args.queueExpanderScript,
    queueExpansions: [],
    iterations,
    events,
    status: 'running',
    blocker: null
  };
  writeJson(path.join(args.artifactRoot, 'run_contract.json'), {
    generatedAt: startedAt,
    benchmarkId: args.benchmarkId,
    fidelity: 'production_slice_autopilot_control_plane',
    scope: 'persistent_autonomous_mailchimp_strict_gap_continuation_until_supported_queue_exhausted_or_blocker',
    targetPath: args.mailchimpRoot,
    runnerScript: args.runnerScript,
    queueExpanderScript: args.queueExpanderScript,
    seedArtifactRoot: args.seedArtifactRoot,
    maxIterations: args.maxIterations,
    stopCondition: 'repeat_supervisor_green_or_blocker_report',
    requiredGates: ['anchor_threshold_pass', 'supported_strict_gap', 'iteration_threshold_pass', 'tests_passed', 'honesty_gate_green', 'strict_inventory_reducer_green_when_global_gap_credit_exists', 'next_queue_or_global_completion', 'global_full_clone_pass_or_claim_blocker_after_strict_inventory_complete']
  });

  let currentAnchor = args.seedArtifactRoot;
  let blocker = null;
  let stopReason = null;

  for (let iteration = 1; iteration <= args.maxIterations; iteration += 1) {
    const anchorSummary = artifactSummary(currentAnchor);
    if (anchorSummary.thresholdPass !== true) {
      const anchorDecision = autonomyDecisionForIteration({ artifactRoot: currentAnchor, summary: anchorSummary }, { seedPreflight: iteration === 1 && currentAnchor === args.seedArtifactRoot });
      events.push({
        type: 'shared_autonomy_decision_for_non_green_anchor',
        generatedAt: new Date().toISOString(),
        iteration,
        anchorArtifactRoot: currentAnchor,
        decision: anchorDecision.decision,
        reason: anchorDecision.reason,
        mayStart: anchorDecision.mayStart,
        nextAssignmentCount: anchorDecision.nextAssignments.count
      });
      if (!anchorDecision.mayStart) {
        blocker = buildBlocker('anchor_not_threshold_green', 'Current anchor artifact is not threshold-pass green and shared autonomy found no executable replan queue.', { anchorArtifactRoot: currentAnchor, anchorSummary, autonomyDecision: anchorDecision });
        stopReason = 'blocker_report_written';
        break;
      }
    }

    let iterationAnchor = currentAnchor;
    let strictGap = firstQueuedGap(currentAnchor, supportedSurfaces) || anchorSummary.nextStrictGap || null;
    if (!strictGap) {
      if (anchorSummary.globalFullClonePass === true || anchorSummary.parityStatus === 'full') {
        stopReason = 'global_completion_observed';
        break;
      } else {
        let expansion = null;
        let strictGapFromExpansion = false;
        const shouldPreferContinuousExpansion = anchorSummary.configuredStrictQueueExhausted === true || anchorSummary.nextWorkQueueCount === 0;
        if (shouldPreferContinuousExpansion) {
          expansion = runQueueExpansion(args, currentAnchor, iteration);
          state.queueExpansions.push(expansion);
          writeState(args, state);
          if (expansion.ok && expansion.strictGap) {
            strictGap = expansion.strictGap;
            iterationAnchor = expansion.artifactRoot;
            strictGapFromExpansion = true;
            events.push({ type: expansion.supportedByContinuationRunner === true ? 'queue_expander_generated_next_work' : 'queue_expander_candidate_not_supported', generatedAt: new Date().toISOString(), anchorArtifactRoot: currentAnchor, expansionArtifactRoot: expansion.artifactRoot, strictGap, supportedByContinuationRunner: expansion.supportedByContinuationRunner });
          }
        }
        if (!strictGap) strictGap = expandedFallbackGapAfter(anchorSummary, supportedCatalog.fallbackRemainingStrictGaps, supportedGapSet);
        if (strictGap && !strictGapFromExpansion) {
          events.push({ type: 'fallback_strict_gap_expanded_after_queue_exhaustion', generatedAt: new Date().toISOString(), anchorArtifactRoot: currentAnchor, strictGap, selectedAfter: anchorSummary.selectedStrictGap || null });
        } else if (!strictGap) {
          if (!expansion) {
            expansion = runQueueExpansion(args, currentAnchor, iteration);
            state.queueExpansions.push(expansion);
            writeState(args, state);
          }
          if (expansion.ok && expansion.strictGap) {
            strictGap = expansion.strictGap;
            iterationAnchor = expansion.artifactRoot;
            strictGapFromExpansion = true;
            events.push({ type: 'queue_expander_generated_next_work', generatedAt: new Date().toISOString(), anchorArtifactRoot: currentAnchor, expansionArtifactRoot: expansion.artifactRoot, strictGap, supportedByContinuationRunner: expansion.supportedByContinuationRunner });
          } else {
            blocker = buildBlocker('no_next_work_queue_without_global_completion', 'Anchor artifact has no next work queue, but global full-clone completion was not proven and the continuous queue expander did not produce next work.', { anchorArtifactRoot: currentAnchor, anchorSummary, queueExpansion: expansion });
            stopReason = 'blocker_report_written';
            break;
          }
        }
      }
    }

    if (args.stopOnUnsupported && !supportedGapSet.has(strictGap)) {
      blocker = buildBlocker('unsupported_strict_gap_surface', 'The next queued strict gap has no registered autonomous continuation surface, so continuing would risk looping or fake-green progress.', {
        strictGap,
        anchorArtifactRoot: currentAnchor,
        supportedStrictGaps: [...supportedGapSet],
        nextAction: 'Add a grounded product surface handler/proof contract for this strict gap, then relaunch the autopilot from this anchor.'
      });
      stopReason = 'unsupported_gap_blocker_report_written';
      break;
    }

    events.push({ type: 'iteration_started', generatedAt: new Date().toISOString(), iteration, anchorArtifactRoot: iterationAnchor, sourceAnchorArtifactRoot: currentAnchor, strictGap });
    const result = runContinuationIteration(args, iterationAnchor, iteration, strictGap);
    iterations.push(result);
    events.push({ type: 'iteration_finished', generatedAt: new Date().toISOString(), iteration, artifactRoot: result.artifactRoot, status: result.status, thresholdPass: result.thresholdPass, nextStrictGap: result.nextStrictGap });
    state.currentAnchorArtifactRoot = result.artifactRoot;
    state.latestIteration = result;
    writeState(args, state);

    if (result.status !== 0 || !result.thresholdPass || result.supervisorStatus !== 'green' || !result.testsPassed || !result.honestyOk || result.blocker) {
      const autonomyDecision = autonomyDecisionForIteration(result);
      result.autonomyDecision = {
        decision: autonomyDecision.decision,
        mayStart: autonomyDecision.mayStart,
        reason: autonomyDecision.reason,
        nextAssignmentCount: autonomyDecision.nextAssignments.count,
        supervisorStatus: autonomyDecision.supervisorStatus
      };
      events.push({
        type: 'shared_autonomy_decision_after_non_green_iteration',
        generatedAt: new Date().toISOString(),
        iteration,
        artifactRoot: result.artifactRoot,
        decision: autonomyDecision.decision,
        reason: autonomyDecision.reason,
        mayStart: autonomyDecision.mayStart,
        nextAssignments: autonomyDecision.nextAssignments.assignments.map((entry) => ({ id: entry.id, strictGap: entry.strictGap, parentSurfaceId: entry.parentSurfaceId }))
      });
      if (autonomyDecision.mayStart && autonomyDecision.decision === 'continue_next_work_queue') {
        currentAnchor = result.artifactRoot;
        state.currentAnchorArtifactRoot = currentAnchor;
        state.latestIteration = result;
        writeState(args, state);
        continue;
      }
      blocker = buildBlocker('iteration_not_green', 'Continuation iteration failed one or more required gates.', { iteration, iterationArtifactRoot: result.artifactRoot, result });
      stopReason = 'blocker_report_written';
      break;
    }

    const reductionCheckpoint = buildStrictInventoryReduction({ mailchimpRoot: args.mailchimpRoot, artifactRoot: args.artifactRoot, iterations });
    events.push({ type: 'strict_inventory_reduction_checkpoint', generatedAt: new Date().toISOString(), iteration, creditedGapCount: reductionCheckpoint.creditedGapCount, remainingGapCount: reductionCheckpoint.remainingGapCount, rejectedCreditCount: reductionCheckpoint.rejectedCreditCount, allInventoryGapsCredited: reductionCheckpoint.allInventoryGapsCredited });
    if (reductionCheckpoint.rejectedCreditCount > 0) {
      blocker = buildBlocker('strict_inventory_reduction_failed', 'One or more global gap credits failed the strict inventory reducer, so autopilot refuses to continue.', { iteration, iterationArtifactRoot: result.artifactRoot, strictInventoryReduction: { creditedGapCount: reductionCheckpoint.creditedGapCount, rejectedCreditCount: reductionCheckpoint.rejectedCreditCount, remainingGapCount: reductionCheckpoint.remainingGapCount, rejectedCredits: reductionCheckpoint.rejectedCredits } });
      stopReason = 'blocker_report_written';
      break;
    }
    if (reductionCheckpoint.allInventoryGapsCredited) {
      stopReason = 'strict_inventory_reduction_complete';
      currentAnchor = result.artifactRoot;
      break;
    }

    if (!result.nextStrictGap) {
      if (result.summary.globalFullClonePass === true) {
        stopReason = 'global_completion_observed';
        break;
      }
      currentAnchor = result.artifactRoot;
      if (iteration < args.maxIterations) {
        events.push({ type: 'iteration_queue_exhausted_replan_next_loop', generatedAt: new Date().toISOString(), iteration, anchorArtifactRoot: currentAnchor });
        continue;
      }
      stopReason = 'max_iterations_reached';
      break;
    }

    currentAnchor = result.artifactRoot;
    if (iteration === args.maxIterations) {
      stopReason = 'max_iterations_reached';
    }
  }

  const completedAt = new Date().toISOString();
  const strictInventoryReduction = buildStrictInventoryReduction({ mailchimpRoot: args.mailchimpRoot, artifactRoot: args.artifactRoot, iterations, generatedAt: completedAt });
  const iterationGatePass = iterations.length > 0 && iterations.every((entry) => {
    const greenIteration = entry.thresholdPass && entry.status === 0 && entry.testsPassed && entry.honestyOk;
    const safelyReplanned = entry.status === 0 && entry.autonomyDecision?.decision === 'continue_next_work_queue' && entry.autonomyDecision?.mayStart === true;
    return greenIteration || safelyReplanned;
  });
  const inventoryGatePass = strictInventoryReduction.globalCreditAttemptCount > 0 ? strictInventoryReduction.runCreditOk : true;
  if (!blocker && !inventoryGatePass) {
    blocker = buildBlocker('strict_inventory_reduction_failed', 'Global gap credit artifacts did not satisfy strict inventory reduction gates.', {
      strictInventoryReduction: {
        creditedGapCount: strictInventoryReduction.creditedGapCount,
        rejectedCreditCount: strictInventoryReduction.rejectedCreditCount,
        remainingGapCount: strictInventoryReduction.remainingGapCount,
        rejectedCredits: strictInventoryReduction.rejectedCredits
      }
    });
    stopReason = 'blocker_report_written';
  }
  const globalFullClonePass = observedGlobalFullClonePass(args, state.currentAnchorArtifactRoot, iterations);
  if (!blocker && strictInventoryReduction.allInventoryGapsCredited && !globalFullClonePass) {
    blocker = buildBlocker('strict_inventory_reduction_complete_full_clone_unproven', 'Strict 1:1 gap inventory credits are exhausted, but no authoritative global full-clone pass/full parity artifact was observed. Autopilot must stop as claim-blocked rather than emit a blocker-free green completion.', {
      claimBlocked: true,
      previousStopReason: stopReason || 'strict_inventory_reduction_complete',
      strictInventoryReduction: {
        creditedGapCount: strictInventoryReduction.creditedGapCount,
        remainingGapCount: strictInventoryReduction.remainingGapCount,
        globalCreditAttemptCount: strictInventoryReduction.globalCreditAttemptCount,
        allInventoryGapsCredited: strictInventoryReduction.allInventoryGapsCredited
      },
      nextAction: 'Run a fresh full-clone parity/negative-space inventory and continue from any remaining open surface, or attach an authoritative globalFullClonePass/full parity artifact before claiming completion.'
    });
    stopReason = 'claim_blocked_after_strict_inventory_reduction';
  }
  const thresholdPass = iterationGatePass && inventoryGatePass && !blocker;
  state.generatedAt = completedAt;
  state.status = blocker ? 'blocked' : (stopReason === 'max_iterations_reached' ? 'paused' : 'completed');
  state.stopReason = stopReason || (blocker ? 'blocker_report_written' : 'completed');
  state.blocker = blocker;
  state.thresholdPass = thresholdPass;
  writeState(args, state);

  const completion = {
    generatedAt: completedAt,
    benchmarkId: args.benchmarkId,
    runId: `${args.benchmarkId}-${path.basename(args.artifactRoot)}`,
    artifactRoot: args.artifactRoot,
    targetPath: args.mailchimpRoot,
    seedArtifactRoot: args.seedArtifactRoot,
    latestAnchorArtifactRoot: state.currentAnchorArtifactRoot,
    fidelity: 'production_slice_autopilot_control_plane',
    implementationSurface: 'control_plane_autopilot_wrapper_plus_existing_product_continuation_runner',
    stopCondition: 'repeat_supervisor_green_or_blocker_report',
    thresholdPass,
    supervisorStatus: blocker ? 'blocked' : 'green_for_autopilot_scope',
    mechanicalGreen: iterationGatePass,
    scaleProofReady: false,
    scaleProofRequired: false,
    globalFullClonePass,
    parityStatus: globalFullClonePass ? 'full' : 'not_full_clone',
    strictInventoryReduction: {
      status: strictInventoryReduction.status,
      runCreditOk: strictInventoryReduction.runCreditOk,
      allInventoryGapsCredited: strictInventoryReduction.allInventoryGapsCredited,
      baselineRemainingGapCount: strictInventoryReduction.baselineRemainingGapCount,
      globalCreditAttemptCount: strictInventoryReduction.globalCreditAttemptCount,
      creditedGapCount: strictInventoryReduction.creditedGapCount,
      rejectedCreditCount: strictInventoryReduction.rejectedCreditCount,
      remainingGapCount: strictInventoryReduction.remainingGapCount,
      artifactPath: path.join(args.artifactRoot, 'strict_1to1_gap_inventory_reduction.json')
    },
    iterationCount: iterations.length,
    maxIterations: args.maxIterations,
    stopReason: state.stopReason,
    nextStrictGap: blocker?.strictGap || state.latestIteration?.nextStrictGap || firstQueuedGap(state.currentAnchorArtifactRoot, supportedSurfaces) || null,
    queueExpansions: state.queueExpansions.map((entry) => ({ artifactRoot: entry.artifactRoot, status: entry.status, strictGap: entry.strictGap, supportedByContinuationRunner: entry.supportedByContinuationRunner, ok: entry.ok })),
    iterations: iterations.map((entry) => ({ iterationId: entry.iterationId, artifactRoot: entry.artifactRoot, selectedStrictGap: entry.selectedStrictGap, selectedSurfaceId: entry.selectedSurfaceId, thresholdPass: entry.thresholdPass, testsPassed: entry.testsPassed, honestyOk: entry.honestyOk, nextStrictGap: entry.nextStrictGap, autonomyDecision: entry.autonomyDecision || null })),
    blocker,
    truthBoundary: 'This artifact proves the persistent autopilot control loop can repeatedly consume next_work_queue artifacts and launch the autonomous continuation runner until a required gate fails, max iterations are reached, or an unsupported strict gap requires a new grounded product surface. It is not a Mailchimp full-clone completion claim.'
  };
  const thresholdEvaluation = {
    generatedAt: completedAt,
    thresholdPass,
    ok: thresholdPass,
    scaleProofRequired: false,
    benchmarkTier: 'mailchimp_autonomous_strict_gap_autopilot_control_plane',
    failures: thresholdPass ? [] : [{ metric: blocker?.blockerKind || 'autopilot_not_green', actual: false, requirement: '= true', reason: blocker?.message || state.stopReason }],
    metrics: {
      iterationsGreen: iterations.every((entry) => entry.thresholdPass && entry.status === 0),
      iterationsGreenOrSafelyReplanned: iterationGatePass,
      safelyReplannedIterationCount: iterations.filter((entry) => entry.autonomyDecision?.decision === 'continue_next_work_queue' && entry.autonomyDecision?.mayStart === true).length,
      iterationCount: iterations.length,
      blockerFree: !blocker,
      stoppedOnMaxIterations: state.stopReason === 'max_iterations_reached',
      unsupportedGap: blocker?.blockerKind === 'unsupported_strict_gap_surface',
      strictInventoryRunCreditOk: strictInventoryReduction.runCreditOk,
      strictInventoryCreditedGapCount: strictInventoryReduction.creditedGapCount,
      strictInventoryRemainingGapCount: strictInventoryReduction.remainingGapCount,
      strictInventoryRejectedCreditCount: strictInventoryReduction.rejectedCreditCount,
      strictInventoryAllGapsCredited: strictInventoryReduction.allInventoryGapsCredited
    }
  };
  const runStateTruth = reduceRunState({
    completionSummary: completion,
    thresholdEvaluation,
    supervisorStatus: { status: blocker ? 'red' : 'green' },
    blocker,
    scaleProofRequired: false
  }, { generatedAt: completedAt });
  writeJson(path.join(args.artifactRoot, 'strict_1to1_gap_inventory_reduction.json'), strictInventoryReduction);
  writeJson(path.join(args.artifactRoot, 'completion_summary.json'), completion);
  writeJson(path.join(args.artifactRoot, 'threshold_evaluation.json'), thresholdEvaluation);
  writeJson(path.join(args.artifactRoot, 'run_state_truth.json'), runStateTruth);
  if (blocker) writeJson(path.join(args.artifactRoot, 'blocker_report.json'), { generatedAt: completedAt, benchmarkId: args.benchmarkId, status: 'blocked', ...blocker });

  console.log(JSON.stringify({ ok: !blocker, thresholdPass, status: state.status, stopReason: state.stopReason, iterationCount: iterations.length, artifactRoot: args.artifactRoot, latestAnchorArtifactRoot: state.currentAnchorArtifactRoot, nextStrictGap: completion.nextStrictGap, blocker }, null, 2));
  process.exit(blocker ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
