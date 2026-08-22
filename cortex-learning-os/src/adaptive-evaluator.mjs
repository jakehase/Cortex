import { exactMcNemarP } from './ab-experiment.mjs';
import { replayGeneratedExercise } from './generated-exercises.mjs';

function positiveUsage(usage) {
  return usage && typeof usage === 'object' && !Array.isArray(usage)
    && Object.entries(usage).some(([key, value]) => /(?:input|output|total|token)/i.test(key) && Number(value) > 0);
}

export function buildPairedCandidatePlan({ candidate, conceptId, seed, policy, generateExercise } = {}) {
  if (candidate?.status !== 'validated') throw new Error('only a validated candidate can receive a paired plan');
  const pairs = Array.from({ length: policy.pairedEvaluation.pairCount }, (_, index) => {
    const pairId = `candidate-pair-${String(index + 1).padStart(2, '0')}`;
    const item = generateExercise({ conceptId, seed: `${seed}:${pairId}`, role: 'promotion-transfer' });
    const forward = Number.parseInt(item.itemId.slice(-2), 16) % 2 === 0;
    const trials = [
      { arm: 'candidate_context', sessionId: `${candidate.candidateId}-${pairId}-candidate` },
      { arm: 'no_context', sessionId: `${candidate.candidateId}-${pairId}-control` },
    ];
    return {
      pairId,
      item,
      trials: forward ? trials : [...trials].reverse(),
    };
  });
  return {
    schemaVersion: 'cortex.learning_os.adaptive_paired_plan.v1',
    candidateId: candidate.candidateId,
    conceptId,
    seed,
    generatedAt: candidate.createdAt,
    design: {
      sameGeneratedItemAcrossArms: true,
      freshSessionPerTrial: true,
      toolsAllowed: false,
      pairCount: pairs.length,
      thresholds: policy.pairedEvaluation,
      analysis: 'two-sided exact McNemar test over valid identical-item pairs',
    },
    pairs,
  };
}

export function analyzeCandidatePairs({ plan, trials, policy, generatedAt = new Date().toISOString() } = {}) {
  const expected = new Map();
  for (const pair of plan?.pairs || []) {
    replayGeneratedExercise(pair.item);
    for (const scheduled of pair.trials) expected.set(`${pair.pairId}:${scheduled.arm}`, { pair, scheduled });
  }
  if (expected.size !== policy.pairedEvaluation.pairCount * 2) throw new Error('paired plan does not match policy pair count');
  const supplied = new Map();
  for (const trial of trials || []) {
    const key = `${trial.pairId}:${trial.arm}`;
    if (!expected.has(key)) throw new Error(`unexpected paired trial: ${key}`);
    if (supplied.has(key)) throw new Error(`duplicate paired trial: ${key}`);
    supplied.set(key, trial);
  }
  let validPairs = 0; let candidatePasses = 0; let controlPasses = 0;
  let candidateOnly = 0; let controlOnly = 0; let bothPass = 0; let bothFail = 0;
  const pairResults = [];
  for (const pair of plan.pairs) {
    const candidate = supplied.get(`${pair.pairId}:candidate_context`);
    const control = supplied.get(`${pair.pairId}:no_context`);
    const validTrial = (trial, arm) => trial
      && trial.sessionId === pair.trials.find((row) => row.arm === arm).sessionId
      && trial.itemId === pair.item.itemId
      && trial.answerSource?.sessionId === trial.sessionId
      && trial.answerSource?.provider === 'openai-codex'
      && typeof trial.answerSource.model === 'string'
      && positiveUsage(trial.answerSource.usage)
      && Array.isArray(trial.toolsUsed) && trial.toolsUsed.length === 0
      && typeof trial.passed === 'boolean';
    const valid = Boolean(validTrial(candidate, 'candidate_context') && validTrial(control, 'no_context'));
    let outcome = 'invalid';
    if (valid) {
      validPairs += 1;
      if (candidate.passed) candidatePasses += 1;
      if (control.passed) controlPasses += 1;
      if (candidate.passed && control.passed) { bothPass += 1; outcome = 'both_pass'; }
      else if (!candidate.passed && !control.passed) { bothFail += 1; outcome = 'both_fail'; }
      else if (candidate.passed) { candidateOnly += 1; outcome = 'candidate_only'; }
      else { controlOnly += 1; outcome = 'no_candidate_only'; }
    }
    pairResults.push({ pairId: pair.pairId, valid, outcome });
  }
  const candidateAccuracy = validPairs ? candidatePasses / validPairs : 0;
  const controlAccuracy = validPairs ? controlPasses / validPairs : 0;
  const lift = candidateAccuracy - controlAccuracy;
  const exactP = exactMcNemarP(candidateOnly, controlOnly);
  const thresholds = policy.pairedEvaluation;
  const gates = {
    minimumValidPairs: validPairs >= thresholds.minimumValidPairs,
    candidateAccuracy: candidateAccuracy >= thresholds.minimumCandidateAccuracy,
    absoluteLift: lift >= thresholds.minimumAbsoluteLift,
    noRegression: controlOnly <= thresholds.maximumNoCandidateOnlyRegressions,
    exactAnalysis: exactP <= thresholds.maximumExactMcNemarP,
  };
  return {
    schemaVersion: 'cortex.learning_os.adaptive_candidate_analysis.v1',
    candidateId: plan.candidateId,
    generatedAt,
    mechanicallyComplete: supplied.size === expected.size,
    thresholdPassed: Object.values(gates).every(Boolean),
    counts: { validPairs, candidatePasses, controlPasses, bothPass, bothFail, candidateOnly, controlOnly },
    estimates: {
      candidateAccuracy: Number(candidateAccuracy.toFixed(6)),
      noCandidateAccuracy: Number(controlAccuracy.toFixed(6)),
      absoluteLift: Number(lift.toFixed(6)),
      exactMcNemarTwoSidedP: Number(exactP.toFixed(9)),
    },
    gates,
    pairResults,
    truthBoundary: 'A threshold pass supports only a bounded causal effect of this candidate context on the preregistered generated items. A null result cannot install a lesson.',
  };
}
