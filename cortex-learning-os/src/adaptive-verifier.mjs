import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson, LESSON_SCHEMA, validateLiveLesson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { buildPairedCandidatePlan, analyzeCandidatePairs } from './adaptive-evaluator.mjs';
import { verifyAdaptivePlanSignature } from './adaptive-session.mjs';
import { policyDigest, validateAdaptivePlanRuntime } from './adaptive-policy.mjs';
import { selectNextAction } from './curriculum-planner.mjs';
import { gradeExam } from './exam-runner.mjs';
import { generateExercise, replayGeneratedExercise } from './generated-exercises.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import { buildCandidatePrompt, buildCandidateRecord } from './model-candidate.mjs';
import { buildExamPrompt, extractJson, observedToolEvents } from './model-answer-runner.mjs';

function readRequired(filePath, maximumBytes = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`required adaptive artifact is not a regular file: ${filePath}`);
  if (stat.size < 1 || stat.size > maximumBytes) throw new Error(`required adaptive artifact size is outside limits: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function positiveUsage(usage) {
  return usage && typeof usage === 'object' && !Array.isArray(usage)
    && Object.entries(usage).some(([key, value]) => /(?:input|output|total|token)/i.test(key) && Number(value) > 0);
}

function verifyProvenance(answerSet, label, { allowTestFixtures = false, expectedRuntime } = {}) {
  const kinds = allowTestFixtures ? ['codex_exec_ephemeral', 'test_fixture'] : ['codex_exec_ephemeral'];
  if (!kinds.includes(answerSet?.answerSource?.kind)
      || answerSet.answerSource.provider !== 'openai-codex'
      || answerSet.answerSource.provider !== expectedRuntime?.provider
      || answerSet.answerSource.model !== expectedRuntime?.model) {
    throw new Error(`${label} source mismatch or incomplete model provenance`);
  }
  if (!positiveUsage(answerSet.answerSource.usage)) throw new Error(`${label} missing positive model usage`);
  if (!Array.isArray(answerSet.toolsUsed) || answerSet.toolsUsed.length !== 0) throw new Error(`${label} observed tool use`);
}

function verifyAttemptTiming(answerSet, label, { notBeforeMs, notAfterMs } = {}) {
  const startedAt = Date.parse(String(answerSet?.startedAt || ''));
  const completedAt = Date.parse(String(answerSet?.completedAt || ''));
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt
      || startedAt < notBeforeMs || completedAt > notAfterMs) throw new Error(`${label} model timing is outside the signed-plan verification window`);
}

function verifyRawModelProvenance(modelCall, answerSource, toolsUsed, label, expectedRuntime) {
  const modelIndex = Array.isArray(modelCall?.args) ? modelCall.args.indexOf('--model') : -1;
  const sandboxIndex = Array.isArray(modelCall?.args) ? modelCall.args.indexOf('--sandbox') : -1;
  const reasoningBound = Array.isArray(modelCall?.args) && modelCall.args.some((arg, index) => arg === '--config'
    && modelCall.args[index + 1] === `model_reasoning_effort="${expectedRuntime?.thinking}"`);
  if (typeof modelCall?.command !== 'string' || path.basename(modelCall.command) !== 'codex'
      || modelCall.exitCode !== 0 || modelCall.sessionId !== answerSource?.sessionId
      || !Array.isArray(modelCall.args)
      || !modelCall.args.includes('--ephemeral') || !modelCall.args.includes('--ignore-user-config')
      || !modelCall.args.includes('--json') || !modelCall.args.includes('--output-schema')
      || modelIndex < 0 || modelCall.args[modelIndex + 1] !== answerSource?.model
      || sandboxIndex < 0 || modelCall.args[sandboxIndex + 1] !== 'read-only' || !reasoningBound) {
    throw new Error(`${label} raw model runtime is not the approved structured read-only path`);
  }
  const usageEvent = [...(modelCall.events || [])].reverse().find((event) => event?.usage || event?.item?.usage);
  const rawUsage = usageEvent?.usage || usageEvent?.item?.usage || null;
  if (!positiveUsage(rawUsage) || canonicalJson(rawUsage) !== canonicalJson(answerSource?.usage)) throw new Error(`${label} raw/model usage mismatch`);
  const rawTools = observedToolEvents(modelCall.events || []).map((event) => event?.item?.type || event?.type || 'unknown_tool');
  if (canonicalJson(rawTools) !== canonicalJson(toolsUsed)) throw new Error(`${label} raw/model tool provenance mismatch`);
}

function verifyFailedCandidateRuntime(modelCall, plan) {
  const modelIndex = Array.isArray(modelCall?.args) ? modelCall.args.indexOf('--model') : -1;
  const sandboxIndex = Array.isArray(modelCall?.args) ? modelCall.args.indexOf('--sandbox') : -1;
  const reasoningBound = Array.isArray(modelCall?.args) && modelCall.args.some((arg, index) => arg === '--config'
    && modelCall.args[index + 1] === `model_reasoning_effort="${plan.modelRuntime?.thinking}"`);
  const failed = Number.isInteger(modelCall?.exitCode) ? modelCall.exitCode !== 0 : Boolean(modelCall?.error);
  if (typeof modelCall?.command !== 'string' || path.basename(modelCall.command) !== 'codex'
      || !failed || modelCall.sessionId !== `${plan.runId}-candidate-synthesis`
      || !Array.isArray(modelCall.args)
      || !modelCall.args.includes('--ephemeral') || !modelCall.args.includes('--ignore-user-config')
      || !modelCall.args.includes('--json') || !modelCall.args.includes('--output-schema')
      || modelIndex < 0 || modelCall.args[modelIndex + 1] !== plan.modelRuntime?.model
      || sandboxIndex < 0 || modelCall.args[sandboxIndex + 1] !== 'read-only' || !reasoningBound) {
    throw new Error('failed candidate diagnostic is not the approved structured read-only runtime');
  }
  if (observedToolEvents(modelCall.events || []).length !== 0) throw new Error('failed candidate diagnostic observed tool use');
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : entry.isFile() ? [target] : [];
  });
}

export function verifyAdaptiveManifest(artifactRoot, manifest, policy) {
  if (manifest?.schemaVersion !== 'cortex.learning_os.run_manifest.v0'
      || !Array.isArray(manifest.files) || manifest.files.length < 2
      || manifest.files.length > policy.budgets.maxArtifactFiles) throw new Error('invalid adaptive artifact manifest');
  const seen = new Set();
  let bytes = 0;
  for (const row of manifest.files) {
    if (!row || typeof row.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(row.path)
        || path.isAbsolute(row.path) || row.path.split('/').includes('..') || seen.has(row.path)) throw new Error('unsafe or duplicate adaptive manifest path');
    seen.add(row.path);
    if (!/^[0-9a-f]{64}$/.test(String(row.sha256 || '')) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw new Error(`invalid adaptive manifest row: ${row.path}`);
    const target = path.resolve(artifactRoot, row.path);
    if (!target.startsWith(`${artifactRoot}${path.sep}`)) throw new Error('adaptive manifest path escaped root');
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.bytes || sha256File(target) !== row.sha256) throw new Error(`adaptive manifest mutation: ${row.path}`);
    bytes += stat.size;
  }
  if (bytes > policy.budgets.maxArtifactBytes) throw new Error('adaptive artifact size budget exceeded');
  const actual = new Set(listFiles(artifactRoot).map((file) => path.relative(artifactRoot, file)).filter((file) => file !== 'artifact_manifest.json'));
  if (canonicalJson([...actual].sort()) !== canonicalJson([...seen].sort())) throw new Error('adaptive manifest does not exactly cover artifact files');
  return seen;
}

function replayPhase(artifactRoot, relative, capsule, expectedItem, options, expectedLearningContext = null) {
  const root = path.join(artifactRoot, relative);
  const exam = readRequired(path.join(root, 'exam.json'));
  const answers = readRequired(path.join(root, 'answers.json'));
  const attempts = readRequired(path.join(root, 'attempts.json'));
  const verifiers = readRequired(path.join(root, 'verifier_results.json'));
  const summary = readRequired(path.join(root, 'score_summary.json'));
  const modelCall = readRequired(path.join(root, 'model_call.json'));
  if (canonicalJson(exam.items) !== canonicalJson([expectedItem])) throw new Error(`${relative} generated item mismatch`);
  replayGeneratedExercise(exam.items[0]);
  verifyProvenance(answers, relative, options);
  verifyAttemptTiming(answers, relative, options);
  verifyRawModelProvenance(modelCall, answers.answerSource, answers.toolsUsed, relative, options.expectedRuntime);
  const prompt = fs.readFileSync(path.join(root, 'model_prompt.txt'), 'utf8').trimEnd();
  if (prompt !== buildExamPrompt({ exam, learningContext: expectedLearningContext })) throw new Error(`${relative} model prompt/context mismatch`);
  if (modelCall.exitCode !== 0) throw new Error(`${relative} model call did not complete`);
  if (typeof modelCall.finalText === 'string' && modelCall.finalText) {
    const rawAnswers = extractJson(modelCall.finalText);
    if (canonicalJson(rawAnswers.answers) !== canonicalJson(answers.answers)) throw new Error(`${relative} model output/answer source mismatch`);
  }
  const replay = gradeExam({ capsule, exam, answerSet: answers, runId: summary.runId, now: summary.generatedAt });
  if (canonicalJson(replay.attempts) !== canonicalJson(attempts)) throw new Error(`${relative} attempt replay mismatch`);
  if (canonicalJson(replay.verifierResults) !== canonicalJson(verifiers)) throw new Error(`${relative} verifier replay mismatch`);
  if (canonicalJson(replay.summary) !== canonicalJson(summary)) throw new Error(`${relative} score replay mismatch`);
  return { exam, answers, attempts, verifiers, summary };
}

function eventFor(conceptId, role, phase, relative) {
  const attempt = phase.attempts[0];
  const verifier = phase.verifiers[0];
  return {
    conceptId,
    role,
    passed: verifier.status === 'passed',
    completedAt: attempt.completedAt,
    evidenceDigest: sha256Text(canonicalJson(verifier)),
    evidenceRef: `${relative}/verifier_results.json`,
  };
}

export function verifyAdaptiveArtifacts({
  artifactRoot,
  graph,
  policy,
  capsule,
  currentMastery,
  expectedSourceCommit,
  fixedTemplates = [],
  allowTestFixtures = false,
  planSecret,
} = {}) {
  const root = path.resolve(artifactRoot);
  const manifestPath = path.join(root, 'artifact_manifest.json');
  const manifest = readRequired(manifestPath, 4 * 1024 * 1024);
  verifyAdaptiveManifest(root, manifest, policy);
  const artifactManifestDigest = sha256File(manifestPath);
  const plan = readRequired(path.join(root, 'adaptive_plan.json'));
  const summary = readRequired(path.join(root, 'session_summary.json'));
  if (plan.schemaVersion !== 'cortex.learning_os.adaptive_session_plan.v1') throw new Error('invalid adaptive plan');
  if (!verifyAdaptivePlanSignature(plan, planSecret)) throw new Error('adaptive plan signature mismatch');
  const generatedAtMs = Date.parse(String(plan.generatedAt || ''));
  if (!Number.isFinite(generatedAtMs)) throw new Error('invalid adaptive plan timestamp');
  if (!validateAdaptivePlanRuntime(policy, plan.modelRuntime)) throw new Error('adaptive plan model runtime mismatch');
  const timingOptions = {
    allowTestFixtures,
    expectedRuntime: plan.modelRuntime,
    notBeforeMs: generatedAtMs - 300_000,
    notAfterMs: Date.now() + 300_000,
  };
  if (manifest.runId !== plan.runId || summary.runId !== plan.runId) throw new Error('adaptive runId linkage mismatch');
  if (plan.sourceCommit !== expectedSourceCommit || manifest.sourceCommit !== expectedSourceCommit || summary.sourceCommit !== expectedSourceCommit) throw new Error('adaptive source mismatch');
  if (plan.policyDigest !== policyDigest(policy) || manifest.policyDigest !== plan.policyDigest || summary.policyDigest !== plan.policyDigest) throw new Error('adaptive policy mismatch');
  if (plan.curriculumDigest !== sha256Text(canonicalJson(graph)) || plan.curriculumId !== graph.curriculumId || plan.capsuleId !== graph.capsuleId) throw new Error('adaptive curriculum mismatch');
  if (canonicalJson(plan.budgets) !== canonicalJson(policy.budgets)
      || !validateAdaptivePlanRuntime(policy, plan.modelRuntime)
      || canonicalJson(plan.pairedEvaluation) !== canonicalJson(policy.pairedEvaluation)) throw new Error('adaptive frozen policy fields mismatch');
  const alreadyApplied = currentMastery.appliedRunIds.includes(plan.runId);
  if (alreadyApplied) {
    const receipt = currentMastery.appliedRunReceipts?.find((row) => row.runId === plan.runId);
    if (receipt?.artifactManifestDigest !== artifactManifestDigest) throw new Error('adaptive run artifact receipt mismatch');
  }
  if (!alreadyApplied) {
    if (plan.masteryRevision !== currentMastery.revision || plan.masterySnapshotDigest !== sha256Text(canonicalJson(currentMastery))) throw new Error('adaptive mastery snapshot mismatch');
    const replayedAction = selectNextAction({
      graph,
      mastery: currentMastery,
      policy,
      now: plan.generatedAt,
      seed: plan.seed,
      operatorDirective: plan.operatorDirective ?? null,
    });
    if (canonicalJson(replayedAction) !== canonicalJson(plan.action)) throw new Error('adaptive planner replay mismatch');
  }
  if (summary.status === 'curriculum_currently_satisfied') {
    if (plan.action.reasonCode !== 'curriculum_currently_satisfied' || fs.existsSync(path.join(root, 'proposed_mastery_delta.json'))) {
      throw new Error('invalid curriculum-currently-satisfied artifact');
    }
    return { plan, summary, manifest, artifactManifestDigest, alreadyApplied, recomputedDelta: null, liveEntry: null };
  }
  if (summary.status === 'structured_blocker' && !fs.existsSync(path.join(root, 'proposed_mastery_delta.json'))) {
    if (summary.lessonProposed || summary.masteryDeltaProposed) throw new Error('structured blocker fabricates proposed state');
    if (Array.isArray(summary.diagnosticEvidenceRefs) && summary.diagnosticEvidenceRefs.length > 0) {
      const expectedRefs = ['candidate/model_call.json', 'candidate/model_prompt.txt'];
      if (summary.blockerCode !== 'mechanical_failure'
          || canonicalJson(summary.diagnosticEvidenceRefs) !== canonicalJson(expectedRefs)) {
        throw new Error('structured blocker has invalid diagnostic evidence references');
      }
      const concept = graph.concepts.find((row) => row.conceptId === plan.action.conceptId);
      if (!concept) throw new Error('diagnostic blocker planned concept is unknown');
      const observedItem = generateExercise({
        conceptId: concept.conceptId,
        seed: `${plan.seed}:observed`,
        role: plan.action.role === 'spaced-review' ? 'spaced-review' : 'acquisition',
      });
      const observed = replayPhase(root, 'observed-attempt', capsule, observedItem, timingOptions, null);
      if (observed.verifiers[0].status !== 'failed' || observed.verifiers[0].score !== 0) {
        throw new Error('candidate diagnostic lacks a replayed observed failure');
      }
      const expectedPrompt = buildCandidatePrompt({
        concept, failedItem: observedItem, attempt: observed.attempts[0], verifier: observed.verifiers[0],
      });
      const prompt = fs.readFileSync(path.join(root, 'candidate/model_prompt.txt'), 'utf8').trimEnd();
      if (prompt !== expectedPrompt) throw new Error('failed candidate diagnostic prompt mismatch');
      const modelCall = readRequired(path.join(root, 'candidate/model_call.json'));
      verifyFailedCandidateRuntime(modelCall, plan);
      if (summary.workerExitCode !== modelCall.exitCode) throw new Error('failed candidate diagnostic exit-code mismatch');
      if (fs.existsSync(path.join(root, 'candidate/model_output.json'))
          || fs.existsSync(path.join(root, 'candidate/candidate.json'))) {
        throw new Error('failed candidate diagnostic fabricates candidate output');
      }
    }
    return { plan, summary, manifest, artifactManifestDigest, alreadyApplied, recomputedDelta: null, liveEntry: null };
  }
  const concept = graph.concepts.find((row) => row.conceptId === plan.action.conceptId);
  if (!concept) throw new Error('planned adaptive concept is unknown');
  const observedItem = generateExercise({
    conceptId: concept.conceptId,
    seed: `${plan.seed}:observed`,
    role: plan.action.role === 'spaced-review' ? 'spaced-review' : 'acquisition',
  });
  const observed = replayPhase(root, 'observed-attempt', capsule, observedItem, timingOptions, null);
  const events = [eventFor(concept.conceptId, plan.action.role === 'spaced-review' ? 'spaced-review' : 'acquisition', observed, 'observed-attempt')];
  let candidate = null;
  let analysis = null;
  let qualified = null;
  if (fs.existsSync(path.join(root, 'candidate/candidate.json'))) {
    if (observed.verifiers[0].status !== 'failed' || observed.verifiers[0].score !== 0) throw new Error('fabricated no-failure candidate');
    const output = readRequired(path.join(root, 'candidate/model_output.json'));
    const storedCandidate = readRequired(path.join(root, 'candidate/candidate.json'));
    const modelCall = readRequired(path.join(root, 'candidate/model_call.json'));
    const prompt = fs.readFileSync(path.join(root, 'candidate/model_prompt.txt'), 'utf8').trimEnd();
    const expectedPrompt = buildCandidatePrompt({
      concept, failedItem: observedItem, attempt: observed.attempts[0], verifier: observed.verifiers[0],
    });
    if (prompt !== expectedPrompt) throw new Error('candidate prompt mismatch');
    if (modelCall.exitCode !== 0) throw new Error('candidate model call did not complete');
    const candidateCreatedAt = Date.parse(String(storedCandidate.createdAt || ''));
    if (!Number.isFinite(candidateCreatedAt) || candidateCreatedAt < timingOptions.notBeforeMs || candidateCreatedAt > timingOptions.notAfterMs) {
      throw new Error('candidate model timing is outside the signed-plan verification window');
    }
    if (storedCandidate.provenance.provider !== plan.modelRuntime.provider
        || storedCandidate.provenance.model !== plan.modelRuntime.model) throw new Error('candidate model runtime differs from signed plan');
    verifyRawModelProvenance(modelCall, storedCandidate.provenance, storedCandidate.provenance.toolsUsed, 'candidate', timingOptions.expectedRuntime);
    if (typeof modelCall.finalText === 'string' && modelCall.finalText
        && canonicalJson(extractJson(modelCall.finalText)) !== canonicalJson(output)) throw new Error('candidate output/source mismatch');
    candidate = buildCandidateRecord({
      output,
      concept,
      failedItem: observedItem,
      attempt: observed.attempts[0],
      verifier: observed.verifiers[0],
      provenance: storedCandidate.provenance,
      prompt: expectedPrompt,
      policy,
      fixedTemplates,
      createdAt: storedCandidate.createdAt,
    });
    if (canonicalJson(candidate) !== canonicalJson(storedCandidate)) throw new Error('candidate validation replay mismatch');
  }
  if (fs.existsSync(path.join(root, 'correction/exam.json'))) {
    if (!candidate || candidate.status !== 'validated') throw new Error('correction used an invalid candidate');
    const correctionItem = generateExercise({ conceptId: concept.conceptId, seed: `${plan.seed}:correction`, role: 'correction' });
    const candidateContext = JSON.stringify({
      candidateId: candidate.candidateId,
      rule: candidate.rule,
      scope: candidate.scope,
      contraindications: candidate.contraindications,
    });
    const correction = replayPhase(root, 'correction', capsule, correctionItem, timingOptions, candidateContext);
    events.push(eventFor(concept.conceptId, 'correction', correction, 'correction'));
  }
  if (fs.existsSync(path.join(root, 'paired_plan.json'))) {
    if (!candidate || events.at(-1).passed !== true) throw new Error('paired evaluation lacks passed correction');
    const pairedPlan = readRequired(path.join(root, 'paired_plan.json'));
    const expectedPlan = buildPairedCandidatePlan({
      candidate, conceptId: concept.conceptId, seed: `${plan.seed}:paired`, policy, generateExercise,
    });
    if (canonicalJson(pairedPlan) !== canonicalJson(expectedPlan)) throw new Error('paired plan replay mismatch');
    const storedTrials = readRequired(path.join(root, 'paired_trials.json'));
    const trials = [];
    for (const pair of pairedPlan.pairs) {
      for (const scheduled of pair.trials) {
        const relative = path.join('paired', pair.pairId, scheduled.arm);
        const candidateContext = JSON.stringify({
          candidateId: candidate.candidateId,
          rule: candidate.rule,
          scope: candidate.scope,
          contraindications: candidate.contraindications,
        });
        const phase = replayPhase(
          root,
          relative,
          capsule,
          pair.item,
          timingOptions,
          scheduled.arm === 'candidate_context' ? candidateContext : null,
        );
        const trial = {
          schemaVersion: 'cortex.learning_os.adaptive_paired_trial.v1',
          pairId: pair.pairId,
          arm: scheduled.arm,
          sessionId: scheduled.sessionId,
          itemId: pair.item.itemId,
          answerSource: phase.attempts[0].answerSource,
          toolsUsed: phase.attempts[0].toolsUsed,
          passed: phase.verifiers[0].status === 'passed',
          completedAt: phase.attempts[0].completedAt,
          verifierDigest: sha256Text(canonicalJson(phase.verifiers[0])),
          evidenceRef: `${relative}/verifier_results.json`,
        };
        trials.push(trial);
      }
    }
    if (canonicalJson(trials) !== canonicalJson(storedTrials)) throw new Error('paired trial replay mismatch');
    const storedAnalysis = readRequired(path.join(root, 'candidate_analysis.json'));
    analysis = analyzeCandidatePairs({ plan: pairedPlan, trials, policy, generatedAt: storedAnalysis.generatedAt });
    if (canonicalJson(analysis) !== canonicalJson(storedAnalysis)) throw new Error('candidate paired analysis replay mismatch');
  }
  const storedDelta = readRequired(path.join(root, 'proposed_mastery_delta.json'));
  const recomputedDelta = {
    schemaVersion: 'cortex.learning_os.mastery_delta.v1',
    runId: plan.runId,
    baseRevision: plan.masteryRevision,
    curriculumId: plan.curriculumId,
    capsuleId: plan.capsuleId,
    policyDigest: plan.policyDigest,
    completedAt: events.at(-1).completedAt,
    events,
    authority: 'worker_proposal_only',
    truthBoundary: 'This worker-authored delta is inert until the independent control plane regenerates exercises, re-grades attempts, replays policy, and signs canonical mastery.',
  };
  if (canonicalJson(storedDelta) !== canonicalJson(recomputedDelta)) throw new Error('worker-rewritten mastery delta');
  let liveEntry = null;
  if (fs.existsSync(path.join(root, 'qualified_candidate_lesson.json'))) {
    qualified = readRequired(path.join(root, 'qualified_candidate_lesson.json'));
    if (!candidate || !analysis?.thresholdPassed || summary.status !== 'candidate_lesson_and_mastery_delta') throw new Error('unqualified adaptive lesson proposal');
    const expectedQualified = {
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
    };
    if (canonicalJson(qualified) !== canonicalJson(expectedQualified)) throw new Error('qualified adaptive lesson replay mismatch');
    if (qualified.activationProfile) {
      const promotedAt = qualified.qualifiedAt;
      const retestAfter = new Date(Date.parse(promotedAt) + policy.lessonExpiryDays * 86_400_000).toISOString();
      liveEntry = {
        schemaVersion: LESSON_SCHEMA,
        lessonId: `adaptive_lesson_${sha256Text(`${candidate.candidateId}:${qualified.analysisDigest}`).slice(0, 20)}`,
        capsuleId: plan.capsuleId,
        domain: 'math',
        conceptIds: qualified.conceptIds,
        rule: qualified.rule,
        contraindications: qualified.contraindications,
        promotionProofDigest: qualified.analysisDigest,
        promotedAt,
        retestAfter,
        activationProfiles: [qualified.activationProfile],
        enabled: true,
        source: {
          runId: plan.runId,
          trustedLessonSha256: sha256File(path.join(root, 'qualified_candidate_lesson.json')),
          promotionReportSha256: sha256File(path.join(root, 'candidate_analysis.json')),
          artifactManifestSha256: sha256File(path.join(root, 'artifact_manifest.json')),
        },
      };
      const validation = validateLiveLesson(liveEntry);
      if (!validation.ok) throw new Error(`adaptive live lesson invalid: ${validation.errors.join('; ')}`);
    }
  } else if (analysis?.thresholdPassed || summary.lessonProposed) {
    throw new Error('threshold-qualified analysis omitted its lesson proposal');
  }
  const expectedModelCalls = 1 + (candidate ? 1 : 0) + (events.length > 1 ? 1 : 0)
    + (analysis ? policy.pairedEvaluation.pairCount * 2 : 0);
  if (summary.modelCalls !== expectedModelCalls || summary.masteryDeltaProposed !== true) throw new Error('adaptive summary evidence counts mismatch');
  if (analysis?.thresholdPassed) {
    if (summary.status !== 'candidate_lesson_and_mastery_delta' || summary.lessonProposed !== true
        || summary.candidateStatus !== 'threshold_qualified' || summary.pairedThresholdPassed !== true) {
      throw new Error('adaptive summary over/understates qualified candidate evidence');
    }
  } else {
    if (summary.status !== 'candidate_mastery_delta' || summary.lessonProposed !== false) throw new Error('adaptive summary overstates lesson evidence');
    if (analysis && summary.pairedThresholdPassed !== false) throw new Error('adaptive summary paired result mismatch');
  }
  return { plan, summary, manifest, artifactManifestDigest, alreadyApplied, recomputedDelta, candidate, analysis, qualified, liveEntry };
}
