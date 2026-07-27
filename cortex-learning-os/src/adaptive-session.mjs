import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { buildPairedCandidatePlan, analyzeCandidatePairs } from './adaptive-evaluator.mjs';
import { isContinuousAcquisitionPolicy, policyDigest, validateAdaptivePlanRuntime } from './adaptive-policy.mjs';
import { buildEarlyReviewDirective, selectNextAction, validateCurriculumGraph } from './curriculum-planner.mjs';
import { generateExercise, validateGeneratedExerciseCoverage } from './generated-exercises.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import { writeJson } from './json.mjs';
import { buildCandidatePrompt, buildCandidateRecord } from './model-candidate.mjs';
import { writeExamRun } from './exam-runner.mjs';

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function oneItemExam(capsuleId, examId, title, item) {
  return {
    schemaVersion: 'cortex.learning_os.exam.v0',
    examId,
    capsuleId,
    version: '0.8.0',
    title,
    passThreshold: 1,
    allowedTools: [],
    items: [item],
    truthBoundary: 'This deterministic generated exercise supports only the named role, concept, and recorded session.',
  };
}

function evidenceDigest(verifier) {
  return sha256Text(canonicalJson(verifier));
}

function planSchema(policy) {
  return isContinuousAcquisitionPolicy(policy)
    ? 'cortex.learning_os.adaptive_session_plan.v2'
    : 'cortex.learning_os.adaptive_session_plan.v1';
}

function deltaSchema(plan) {
  return plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
    ? 'cortex.learning_os.mastery_delta.v2'
    : 'cortex.learning_os.mastery_delta.v1';
}

function activeStatus(plan, legacy, continuous) {
  return plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2' ? continuous : legacy;
}

export function buildAdaptiveSessionPlan({
  runId,
  graph,
  policy,
  mastery,
  sourceCommit,
  seed,
  signingSecret,
  runtimeOverride = null,
  allowEarlyReview = false,
  frozenAction = null,
  now = new Date().toISOString(),
} = {}) {
  const graphValidation = validateCurriculumGraph(graph);
  if (!graphValidation.ok) throw new Error(`invalid curriculum graph: ${graphValidation.errors.join('; ')}`);
  const generatorCoverage = validateGeneratedExerciseCoverage(graph);
  if (!generatorCoverage.ok) {
    throw new Error(`adaptive curriculum concepts lack deterministic generators: ${generatorCoverage.missing.join(', ')}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(runId || ''))) throw new Error('invalid adaptive runId');
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))) throw new Error('adaptive plan requires a 40-character source commit');
  if (typeof seed !== 'string' || !seed || seed.length > 256) throw new Error('adaptive plan requires a bounded seed');
  const modelRuntime = runtimeOverride === null ? policy.modelRuntime : runtimeOverride;
  if (!validateAdaptivePlanRuntime(policy, modelRuntime)) throw new Error('adaptive plan runtime override is invalid or weaker than policy');
  if (typeof allowEarlyReview !== 'boolean') throw new Error('allowEarlyReview must be boolean');
  if (isContinuousAcquisitionPolicy(policy) && allowEarlyReview) {
    throw new Error('early-review mode is disabled under the continuous-acquisition policy');
  }
  const operatorDirective = allowEarlyReview ? buildEarlyReviewDirective(now) : null;
  const action = frozenAction === null
    ? selectNextAction({ graph, mastery, policy, now, seed, operatorDirective })
    : structuredClone(frozenAction);
  if (frozenAction !== null && (!isContinuousAcquisitionPolicy(policy)
      || !['acquisition', 'learning_retry', 'prerequisite_repair', 'same_concept_correction'].includes(action?.kind)
      || !['acquisition', 'correction'].includes(action?.role)
      || !graph.concepts.some((concept) => concept.conceptId === action?.conceptId))) {
    throw new Error('invalid frozen continuous-acquisition action');
  }
  if (typeof signingSecret !== 'string' || signingSecret.length < 32) throw new Error('adaptive plan requires a control-plane signing secret');
  const continuous = isContinuousAcquisitionPolicy(policy);
  const plan = {
    schemaVersion: planSchema(policy),
    runId,
    generatedAt: now,
    sourceCommit,
    seed,
    curriculumId: graph.curriculumId,
    capsuleId: graph.capsuleId,
    curriculumDigest: sha256Text(canonicalJson(graph)),
    policyId: policy.policyId,
    policyDigest: policyDigest(policy),
    masteryRevision: mastery.revision,
    masterySnapshotDigest: sha256Text(canonicalJson(mastery)),
    operatorDirective,
    action,
    budgets: structuredClone(policy.budgets),
    modelRuntime: structuredClone(modelRuntime),
    pairedEvaluation: structuredClone(policy.pairedEvaluation),
    terminalStates: continuous
      ? [
        'candidate_acquisition_delta',
        'candidate_lesson_and_acquisition_delta',
        'curriculum_frontier_reached',
        'structured_blocker',
      ]
      : [
        'candidate_mastery_delta',
        'candidate_lesson_and_mastery_delta',
        'curriculum_currently_satisfied',
        'structured_blocker',
      ],
    truthBoundary: operatorDirective
      ? 'The frozen plan authorizes one explicitly early practice review. It is not due/overdue retention evidence and does not authorize canonical mutation without independent replay.'
      : continuous
        ? 'The frozen plan authorizes one bounded acquisition or genuine correction evidence collection only. A pass records covered-once acquisition, not retention, mastery, or model-weight learning; canonical state still requires independent replay.'
        : 'The frozen plan authorizes bounded worker evidence collection only. It does not authorize canonical mastery or live-registry mutation.',
  };
  return {
    ...plan,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: sha256Text(signingSecret).slice(0, 16),
      digest: crypto.createHmac('sha256', signingSecret).update(canonicalJson(plan)).digest('hex'),
    },
  };
}

export function verifyAdaptivePlanSignature(plan, signingSecret) {
  const { controlPlaneSignature, ...payload } = plan || {};
  if (controlPlaneSignature?.algorithm !== 'hmac-sha256'
      || controlPlaneSignature.keyId !== sha256Text(signingSecret).slice(0, 16)
      || !/^[0-9a-f]{64}$/.test(String(controlPlaneSignature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', signingSecret).update(canonicalJson(payload)).digest();
  const actual = Buffer.from(controlPlaneSignature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validatePlan(plan, { graph, policy, sourceCommit }) {
  if (plan?.schemaVersion !== planSchema(policy)) throw new Error('invalid adaptive plan schemaVersion');
  if (plan.curriculumId !== graph.curriculumId || plan.capsuleId !== graph.capsuleId) throw new Error('adaptive plan curriculum scope mismatch');
  if (plan.curriculumDigest !== sha256Text(canonicalJson(graph))) throw new Error('adaptive plan curriculum digest mismatch');
  if (plan.policyDigest !== policyDigest(policy)) throw new Error('adaptive plan policy digest mismatch');
  if (plan.sourceCommit !== sourceCommit) throw new Error('adaptive plan source mismatch');
  if (canonicalJson(plan.budgets) !== canonicalJson(policy.budgets)
      || !validateAdaptivePlanRuntime(policy, plan.modelRuntime)
      || canonicalJson(plan.pairedEvaluation) !== canonicalJson(policy.pairedEvaluation)) throw new Error('adaptive plan policy fields were rewritten');
  if (isContinuousAcquisitionPolicy(policy)
      && (plan.operatorDirective !== null || plan.action?.role === 'spaced-review' || plan.action?.kind === 'spaced_review')) {
    throw new Error('continuous-acquisition plan contains forbidden review behavior');
  }
}

function writeManifest(artifactRoot, plan, truthBoundary) {
  const files = allFiles(artifactRoot)
    .filter((file) => path.resolve(file) !== path.join(path.resolve(artifactRoot), 'artifact_manifest.json'))
    .map((file) => ({ path: path.relative(artifactRoot, file), sha256: sha256File(file), bytes: fs.statSync(file).size }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = files.reduce((sum, row) => sum + row.bytes, 0);
  if (files.length > plan.budgets.maxArtifactFiles || totalBytes > plan.budgets.maxArtifactBytes) throw new Error('adaptive artifact budget exhausted');
  writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'cortex.learning_os.run_manifest.v0',
    runId: plan.runId,
    generatedAt: new Date().toISOString(),
    sourceCommit: plan.sourceCommit,
    policyDigest: plan.policyDigest,
    files,
    commands: [],
    truthBoundary,
  });
}

function phaseWriter({ artifactRoot, capsule, plan, phase, item, call, learningContext, evidenceRole, sessionId = null }) {
  const exam = oneItemExam(capsule.capsuleId, `${plan.runId}-${phase}`, `Adaptive ${phase}`, item);
  const result = call({
    exam,
    learningContext,
    evidenceRole,
    sessionId: sessionId || `${plan.runId}-${phase}`,
    runId: `${plan.runId}-${phase}`,
  });
  const phaseRoot = path.join(artifactRoot, phase);
  fs.mkdirSync(phaseRoot, { recursive: true });
  writeJson(path.join(phaseRoot, 'model_call.json'), result.raw);
  fs.writeFileSync(path.join(phaseRoot, 'model_prompt.txt'), `${result.prompt}\n`, { mode: 0o600 });
  return writeExamRun({
    capsule,
    exam,
    answerSet: result.answerSet,
    runId: `${plan.runId}-${phase}`,
    outputDir: phaseRoot,
    now: result.answerSet.completedAt,
    command: 'bounded structured no-tool model call',
  });
}

function proposedDelta(plan, completedAt, events) {
  return {
    schemaVersion: deltaSchema(plan),
    runId: plan.runId,
    baseRevision: plan.masteryRevision,
    curriculumId: plan.curriculumId,
    capsuleId: plan.capsuleId,
    policyDigest: plan.policyDigest,
    completedAt,
    events,
    authority: 'worker_proposal_only',
    truthBoundary: plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
      ? 'This worker-authored acquisition delta is inert until the independent control plane regenerates exercises, re-grades attempts, replays policy, and signs canonical covered-once state.'
      : 'This worker-authored delta is inert until the independent control plane regenerates exercises, re-grades attempts, replays policy, and signs canonical mastery.',
  };
}

export function runAdaptiveSession({
  plan,
  graph,
  policy,
  capsule,
  artifactRoot,
  sourceCommit,
  callExam,
  callCandidate,
  fixedTemplates = [],
} = {}) {
  validatePlan(plan, { graph, policy, sourceCommit });
  const root = path.resolve(artifactRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  writeJson(path.join(root, 'adaptive_plan.json'), plan);
  let modelCalls = 0;
  const boundedExamCall = (options) => {
    if (modelCalls >= plan.budgets.maxModelCalls) throw new Error('adaptive model-call budget exhausted');
    modelCalls += 1;
    return callExam(options);
  };
  const boundedCandidateCall = (options) => {
    if (modelCalls >= plan.budgets.maxModelCalls) throw new Error('adaptive model-call budget exhausted');
    modelCalls += 1;
    return callCandidate(options);
  };
  const finish = (summary, delta = null) => {
    if (delta) writeJson(path.join(root, 'proposed_mastery_delta.json'), delta);
    const finalSummary = {
      schemaVersion: 'cortex.learning_os.adaptive_session_summary.v1',
      runId: plan.runId,
      sourceCommit,
      policyDigest: plan.policyDigest,
      modelCalls,
      ...summary,
      truthBoundary: plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
        ? 'Worker completion records evidence only. Canonical acquisition state and live lessons remain unchanged until independent control-plane application; retention, mastery, and model-weight learning remain unproven.'
        : 'Worker completion records evidence only. Canonical mastery and live lessons remain unchanged until independent control-plane application.',
    };
    writeJson(path.join(root, 'session_summary.json'), finalSummary);
    writeManifest(root, plan, finalSummary.truthBoundary);
    return finalSummary;
  };
  try {
    if (['curriculum_currently_satisfied', 'curriculum_frontier_reached'].includes(plan.action.reasonCode)) {
      return finish({
        status: plan.action.reasonCode,
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: false }
          : { masteryDeltaProposed: false }),
      });
    }
    if (plan.action.kind === 'terminal') {
      return finish({
        status: 'structured_blocker',
        blockerCode: plan.action.reasonCode,
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: false }
          : { masteryDeltaProposed: false }),
      });
    }
    const concept = graph.concepts.find((row) => row.conceptId === plan.action.conceptId);
    if (!concept) throw new Error('planned concept is absent from curriculum');
    const baselineItem = generateExercise({
      conceptId: concept.conceptId,
      seed: `${plan.seed}:observed`,
      role: plan.action.role,
    });
    const baseline = phaseWriter({
      artifactRoot: root, capsule, plan, phase: 'observed-attempt', item: baselineItem,
      call: boundedExamCall, learningContext: null,
      evidenceRole: plan.action.role,
    });
    const baselineAttempt = baseline.attempts[0];
    const baselineVerifier = baseline.verifierResults[0];
    const baselineEvent = {
      conceptId: concept.conceptId,
      role: plan.action.role,
      passed: baselineVerifier.status === 'passed',
      completedAt: baselineAttempt.completedAt,
      evidenceDigest: evidenceDigest(baselineVerifier),
      evidenceRef: 'observed-attempt/verifier_results.json',
    };
    if (baselineVerifier.status === 'passed') {
      const delta = proposedDelta(plan, baselineAttempt.completedAt, [baselineEvent]);
      return finish({
        status: activeStatus(plan, 'candidate_mastery_delta', 'candidate_acquisition_delta'),
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: true }
          : { masteryDeltaProposed: true }),
      }, delta);
    }
    if (baselineVerifier.status !== 'failed') {
      return finish({
        status: 'structured_blocker',
        blockerCode: 'observed_attempt_not_gradably_failed',
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: false }
          : { masteryDeltaProposed: false }),
      });
    }

    const candidatePrompt = buildCandidatePrompt({
      concept, failedItem: baselineItem, attempt: baselineAttempt, verifier: baselineVerifier,
    });
    const candidateRoot = path.join(root, 'candidate');
    fs.mkdirSync(candidateRoot, { recursive: true });
    let candidateCall;
    try {
      candidateCall = boundedCandidateCall({
        prompt: candidatePrompt,
        sessionId: `${plan.runId}-candidate-synthesis`,
      });
    } catch (error) {
      if (error?.workerRaw && typeof error.workerRaw === 'object' && !Array.isArray(error.workerRaw)) {
        const diagnosticPath = path.join(candidateRoot, 'model_call.json');
        writeJson(diagnosticPath, error.workerRaw);
        fs.chmodSync(diagnosticPath, 0o600);
        fs.writeFileSync(path.join(candidateRoot, 'model_prompt.txt'), `${candidatePrompt}\n`, { mode: 0o600 });
        error.diagnosticEvidenceRefs = ['candidate/model_call.json', 'candidate/model_prompt.txt'];
      }
      throw error;
    }
    writeJson(path.join(candidateRoot, 'model_call.json'), candidateCall.raw);
    fs.writeFileSync(path.join(candidateRoot, 'model_prompt.txt'), `${candidatePrompt}\n`, { mode: 0o600 });
    writeJson(path.join(candidateRoot, 'model_output.json'), candidateCall.output);
    const candidate = buildCandidateRecord({
      output: candidateCall.output,
      concept,
      failedItem: baselineItem,
      attempt: baselineAttempt,
      verifier: baselineVerifier,
      provenance: candidateCall.provenance,
      prompt: candidatePrompt,
      policy,
      fixedTemplates,
      createdAt: candidateCall.completedAt || baselineAttempt.completedAt,
    });
    writeJson(path.join(candidateRoot, 'candidate.json'), candidate);
    if (candidate.status !== 'validated') {
      const delta = proposedDelta(plan, baselineAttempt.completedAt, [baselineEvent]);
      return finish({
        status: activeStatus(plan, 'candidate_mastery_delta', 'candidate_acquisition_delta'),
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: true }
          : { masteryDeltaProposed: true }),
        candidateStatus: 'quarantined', blockerCode: 'candidate_validation_failed',
      }, delta);
    }

    const correctionItem = generateExercise({ conceptId: concept.conceptId, seed: `${plan.seed}:correction`, role: 'correction' });
    const candidateContext = JSON.stringify({
      candidateId: candidate.candidateId,
      rule: candidate.rule,
      scope: candidate.scope,
      contraindications: candidate.contraindications,
    });
    const correction = phaseWriter({
      artifactRoot: root, capsule, plan, phase: 'correction', item: correctionItem,
      call: boundedExamCall, learningContext: candidateContext, evidenceRole: 'correction',
    });
    const correctionAttempt = correction.attempts[0];
    const correctionVerifier = correction.verifierResults[0];
    const events = [
      baselineEvent,
      {
        conceptId: concept.conceptId,
        role: 'correction',
        passed: correctionVerifier.status === 'passed',
        completedAt: correctionAttempt.completedAt,
        evidenceDigest: evidenceDigest(correctionVerifier),
        evidenceRef: 'correction/verifier_results.json',
      },
    ];
    if (correctionVerifier.status !== 'passed') {
      const delta = proposedDelta(plan, correctionAttempt.completedAt, events);
      return finish({
        status: activeStatus(plan, 'candidate_mastery_delta', 'candidate_acquisition_delta'),
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: true }
          : { masteryDeltaProposed: true }),
        candidateStatus: 'validated_not_promoted', blockerCode: 'correction_failed',
      }, delta);
    }

    const pairedPlan = buildPairedCandidatePlan({
      candidate, conceptId: concept.conceptId, seed: `${plan.seed}:paired`, policy, generateExercise,
    });
    writeJson(path.join(root, 'paired_plan.json'), pairedPlan);
    const trials = [];
    for (const pair of pairedPlan.pairs) {
      for (const scheduled of pair.trials) {
        const phase = path.join('paired', pair.pairId, scheduled.arm);
        const run = phaseWriter({
          artifactRoot: root,
          capsule,
          plan,
          phase,
          item: pair.item,
          call: boundedExamCall,
          learningContext: scheduled.arm === 'candidate_context' ? candidateContext : null,
          evidenceRole: `paired_${scheduled.arm}`,
          sessionId: scheduled.sessionId,
        });
        const answer = run.attempts[0];
        const verifier = run.verifierResults[0];
        trials.push({
          schemaVersion: 'cortex.learning_os.adaptive_paired_trial.v1',
          pairId: pair.pairId,
          arm: scheduled.arm,
          sessionId: scheduled.sessionId,
          itemId: pair.item.itemId,
          answerSource: answer.answerSource,
          toolsUsed: answer.toolsUsed,
          passed: verifier.status === 'passed',
          completedAt: answer.completedAt,
          verifierDigest: evidenceDigest(verifier),
          evidenceRef: `${phase}/verifier_results.json`,
        });
      }
    }
    writeJson(path.join(root, 'paired_trials.json'), trials);
    const analysis = analyzeCandidatePairs({ plan: pairedPlan, trials, policy, generatedAt: trials.at(-1).completedAt });
    writeJson(path.join(root, 'candidate_analysis.json'), analysis);
    const delta = proposedDelta(plan, correctionAttempt.completedAt, events);
    if (!analysis.thresholdPassed) {
      return finish({
        status: activeStatus(plan, 'candidate_mastery_delta', 'candidate_acquisition_delta'),
        lessonProposed: false,
        ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
          ? { acquisitionDeltaProposed: true }
          : { masteryDeltaProposed: true }),
        candidateStatus: 'validated_not_promoted', pairedThresholdPassed: false,
      }, delta);
    }
    writeJson(path.join(root, 'qualified_candidate_lesson.json'), {
      schemaVersion: 'cortex.learning_os.qualified_adaptive_lesson.v1',
      candidateId: candidate.candidateId,
      capsuleId: plan.capsuleId,
      conceptIds: [concept.conceptId],
      rule: candidate.rule,
      contraindications: candidate.contraindications,
      analysisDigest: sha256Text(canonicalJson(analysis)),
      qualifiedAt: analysis.generatedAt,
      activationProfile: policy.liveActivationProfileByConcept[concept.conceptId] || null,
      thresholdPassed: true,
      truthBoundary: 'This worker proposal is not live. Independent replay and an approved non-null activation profile are required before signed-registry installation.',
    });
    return finish({
      status: activeStatus(plan, 'candidate_lesson_and_mastery_delta', 'candidate_lesson_and_acquisition_delta'),
      lessonProposed: true,
      ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
        ? { acquisitionDeltaProposed: true }
        : { masteryDeltaProposed: true }),
      candidateStatus: 'threshold_qualified',
      pairedThresholdPassed: true,
    }, delta);
  } catch (error) {
    return finish({
      status: 'structured_blocker',
      blockerCode: /budget exhausted/.test(error.message) ? 'budget_exhausted' : 'mechanical_failure',
      blocker: String(error.message).slice(0, 1000),
      diagnosticEvidenceRefs: Array.isArray(error.diagnosticEvidenceRefs) ? error.diagnosticEvidenceRefs : [],
      workerExitCode: Number.isInteger(error?.workerRaw?.exitCode) ? error.workerRaw.exitCode : null,
      lessonProposed: false,
      ...(plan.schemaVersion === 'cortex.learning_os.adaptive_session_plan.v2'
        ? { acquisitionDeltaProposed: false }
        : { masteryDeltaProposed: false }),
    });
  }
}
