import crypto from 'node:crypto';
import { DeterministicRng, exactMcNemarP } from './ab-experiment.mjs';
import { SCHEMAS, validateRecord } from './contracts.mjs';

const ARMS = ['pack', 'no_pack'];

const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
};
const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

function makeCapsule({ validationId, generatedAt }) {
  const record = {
    schemaVersion: SCHEMAS.capsule,
    capsuleId: `${validationId}-private-utility-capsule-v0`,
    domain: 'selective-private-workspace-knowledge',
    version: '0.1.0',
    trustState: 'candidate',
    activeCurriculumId: `${validationId}-private-utility-curriculum-v0`,
    activeExamIds: [],
    promotionThresholds: { minEvidence: 2, minDistinctExams: 2, minScore: 1, retestDays: 90 },
    truthBoundary: `Frozen ${generatedAt}: low-sensitivity private workspace facts only; no credentials, client-identifying facts, financial identifiers, or network addresses.`
  };
  const validation = validateRecord(record);
  if (!validation.ok) throw new Error(`invalid private utility capsule: ${validation.errors.join('; ')}`);
  return record;
}

export function validateOpenUtilityFixture(fixture, expectedPoolType = null) {
  const errors = [];
  if (fixture?.schemaVersion !== 'cortex.learning_os.private_open_utility_fixture.v0') errors.push('unsupported fixture schema');
  if (!fixture?.fixtureId) errors.push('fixtureId is required');
  if (!['calibration', 'holdout'].includes(fixture?.poolType)) errors.push('poolType must be calibration or holdout');
  if (expectedPoolType && fixture?.poolType !== expectedPoolType) errors.push(`expected poolType ${expectedPoolType}`);
  if (!Array.isArray(fixture?.lessons) || fixture.lessons.length < 2) errors.push('at least two lessons are required');
  if (!Array.isArray(fixture?.items) || fixture.items.length < 4) errors.push('at least four items are required');
  const lessons = new Map();
  const factIds = new Set();
  const conceptIds = new Set();
  for (const lesson of fixture?.lessons || []) {
    const required = ['lessonId', 'factId', 'conceptId', 'rule', 'sourceRef', 'expectedAnswer'];
    if (required.some((key) => !lesson?.[key] && lesson?.[key] !== 0)) errors.push(`lesson missing required field: ${lesson?.lessonId || '<missing>'}`);
    if (lessons.has(lesson.lessonId)) errors.push(`duplicate lessonId: ${lesson.lessonId}`);
    if (factIds.has(lesson.factId)) errors.push(`duplicate factId: ${lesson.factId}`);
    if (conceptIds.has(lesson.conceptId)) errors.push(`duplicate conceptId: ${lesson.conceptId}`);
    if (String(lesson.expectedAnswer).trim() !== String(lesson.expectedAnswer) || !String(lesson.expectedAnswer).trim()) errors.push(`expectedAnswer must be non-empty and trimmed: ${lesson.lessonId}`);
    lessons.set(lesson.lessonId, lesson);
    factIds.add(lesson.factId);
    conceptIds.add(lesson.conceptId);
  }
  const itemIds = new Set();
  const coverage = new Map();
  for (const item of fixture?.items || []) {
    if (!item?.itemId || !item?.lessonId || !item?.prompt) errors.push(`invalid item: ${item?.itemId || '<missing>'}`);
    if (itemIds.has(item.itemId)) errors.push(`duplicate itemId: ${item.itemId}`);
    if (!lessons.has(item.lessonId)) errors.push(`unknown lessonId for ${item.itemId}: ${item.lessonId}`);
    itemIds.add(item.itemId);
    coverage.set(item.lessonId, (coverage.get(item.lessonId) || 0) + 1);
  }
  for (const lessonId of lessons.keys()) {
    if ((coverage.get(lessonId) || 0) !== 2) errors.push(`lesson must have exactly two paraphrased items: ${lessonId}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateDisjointOpenUtilityFixtures(calibrationFixture, holdoutFixture) {
  const errors = [];
  const calibration = validateOpenUtilityFixture(calibrationFixture, 'calibration');
  const holdout = validateOpenUtilityFixture(holdoutFixture, 'holdout');
  errors.push(...calibration.errors.map((error) => `calibration: ${error}`));
  errors.push(...holdout.errors.map((error) => `holdout: ${error}`));
  const fields = ['lessonId', 'factId', 'conceptId'];
  for (const field of fields) {
    const left = new Set((calibrationFixture?.lessons || []).map((lesson) => String(lesson[field])));
    for (const lesson of holdoutFixture?.lessons || []) {
      if (left.has(String(lesson[field]))) errors.push(`fixtures overlap on ${field}: ${lesson[field]}`);
    }
  }
  const calibrationRuleDigests = new Set((calibrationFixture?.lessons || []).map((lesson) => sha256(lesson.rule)));
  for (const lesson of holdoutFixture?.lessons || []) {
    if (calibrationRuleDigests.has(sha256(lesson.rule))) errors.push(`fixtures overlap on rule digest: ${lesson.lessonId}`);
  }
  const calibrationAnswers = new Set((calibrationFixture?.lessons || []).map((lesson) => String(lesson.expectedAnswer).toLowerCase()));
  const sharedAnswers = [...new Set((holdoutFixture?.lessons || []).map((lesson) => String(lesson.expectedAnswer).toLowerCase()).filter((answer) => calibrationAnswers.has(answer)))];
  return { ok: errors.length === 0, errors, sharedAnswers };
}

function trustedLesson({ lesson, capsuleId, fixtureId, generatedAt }) {
  const record = {
    schemaVersion: SCHEMAS.trustedLesson,
    lessonId: lesson.lessonId,
    candidateId: `operator_curated_${sha256(`${fixtureId}:${lesson.lessonId}`).slice(0, 16)}`,
    capsuleId,
    conceptIds: [lesson.conceptId],
    rule: lesson.rule,
    contraindications: ['Apply only when the task asks for this exact named workspace fact; do not generalize it to other systems or dates.'],
    promotionProof: {
      promoted: true,
      promotionMode: 'operator_curated_private_source_of_record',
      sourceRef: lesson.sourceRef,
      digest: sha256({ fixtureId, factId: lesson.factId, rule: lesson.rule, answer: lesson.expectedAnswer }),
      truthBoundary: 'Curation establishes the frozen source-of-record answer only; this experiment tests conditional retrieval utility.'
    },
    promotedAt: generatedAt,
    retestAfter: addDays(generatedAt, 90),
    sourceExamIds: [`${fixtureId}-operator-source-review`]
  };
  const validation = validateRecord(record);
  if (!validation.ok) throw new Error(`invalid trusted lesson ${lesson.lessonId}: ${validation.errors.join('; ')}`);
  return record;
}

function buildItems(fixture) {
  const lessonById = new Map(fixture.lessons.map((lesson) => [lesson.lessonId, lesson]));
  return fixture.items.map((item, index) => {
    const lesson = lessonById.get(item.lessonId);
    return {
      pairId: `pair-${String(index + 1).padStart(3, '0')}`,
      clusterId: lesson.factId,
      itemId: item.itemId,
      lessonId: item.lessonId,
      prompt: item.prompt,
      conceptIds: [lesson.conceptId],
      answerFormat: 'Return only the exact requested value or identifier, with no explanation, label, quotation marks, or punctuation.',
      checker: { mode: 'exact_string', expected: String(lesson.expectedAnswer), caseSensitive: false }
    };
  });
}

function calibrationSchedule({ validationId, seed, items }) {
  const rng = new DeterministicRng(`${seed}:open-utility-calibration-schedule:v1`);
  return rng.shuffle(items.map((item) => item.pairId)).map((pairId, index) => ({
    phase: 'calibration',
    ordinal: index + 1,
    pairId,
    clusterId: items.find((item) => item.pairId === pairId).clusterId,
    arm: 'no_pack',
    sessionId: `${validationId}-calibration-${pairId}-${sha256(`${seed}:calibration:${pairId}`).slice(0, 12)}`
  }));
}

function holdoutSchedule({ validationId, seed, items }) {
  const rng = new DeterministicRng(`${seed}:open-utility-holdout-schedule:v1`);
  const rows = [];
  for (const item of rng.shuffle(items)) {
    const arms = rng.int(2) === 0 ? ARMS : [...ARMS].reverse();
    for (const arm of arms) {
      rows.push({
        phase: 'holdout',
        pairId: item.pairId,
        clusterId: item.clusterId,
        arm,
        sessionId: `${validationId}-holdout-${item.pairId}-${arm}-${sha256(`${seed}:holdout:${item.pairId}:${arm}`).slice(0, 12)}`
      });
    }
  }
  return rng.shuffle(rows).map((row, index) => ({ ...row, ordinal: index + 1 }));
}

export function buildPrivateUtilityProgram({
  validationId,
  seed,
  calibrationFixture,
  holdoutFixture,
  model = 'gpt-5.6-sol',
  thinking = 'xhigh',
  generatedAt = new Date().toISOString()
} = {}) {
  if (!validationId || !seed) throw new Error('validationId and seed are required');
  const disjoint = validateDisjointOpenUtilityFixtures(calibrationFixture, holdoutFixture);
  if (!disjoint.ok) throw new Error(`invalid or overlapping private fixtures: ${disjoint.errors.join('; ')}`);
  const capsule = makeCapsule({ validationId, generatedAt });
  const calibrationItems = buildItems(calibrationFixture);
  const holdoutItems = buildItems(holdoutFixture);
  const lessons = holdoutFixture.lessons.map((lesson) => trustedLesson({ lesson, capsuleId: capsule.capsuleId, fixtureId: holdoutFixture.fixtureId, generatedAt }));
  const calibration = {
    fixtureId: calibrationFixture.fixtureId,
    lessonCount: calibrationFixture.lessons.length,
    itemCount: calibrationItems.length,
    items: calibrationItems,
    schedule: calibrationSchedule({ validationId, seed, items: calibrationItems }),
    thresholds: {
      minimumValidItems: Math.ceil(calibrationItems.length * 0.9),
      maximumInvalidItemRate: 0.1,
      maximumNoPackItemAccuracy: 0.6,
      maximumNoPackClusterAccuracy: 0.5
    },
    truthBoundary: 'Calibration checks headroom on a disjoint private-fact pool. It is not efficacy evidence and cannot contribute held-out wins.'
  };
  const holdout = {
    fixtureId: holdoutFixture.fixtureId,
    lessonCount: holdoutFixture.lessons.length,
    itemCount: holdoutItems.length,
    pairCount: holdoutItems.length,
    clusterCount: holdoutFixture.lessons.length,
    items: holdoutItems,
    trustedLessons: lessons,
    schedule: holdoutSchedule({ validationId, seed, items: holdoutItems }),
    thresholds: {
      minimumValidItemPairs: Math.ceil(holdoutItems.length * 0.9),
      minimumValidClusters: Math.ceil(holdoutFixture.lessons.length * 0.9),
      maximumInvalidClusterRate: 0.1,
      minimumPackItemAccuracy: 0.9,
      minimumPackClusterAccuracy: 0.85,
      minimumItemAbsoluteLift: 0.2,
      minimumClusterAbsoluteLift: 0.2,
      alpha: 0.05,
      maximumNoPackOnlyClusters: 1,
      maximumMeanInputTokenOverhead: 1200,
      maximumMedianLatencyOverheadSeconds: 10,
      maximumRetrievalPackTokens: 600
    },
    truthBoundary: 'The held-out test estimates utility only for selectively routed, genuinely non-inferable private workspace facts represented by this frozen pool.'
  };
  const allSessions = [...calibration.schedule, ...holdout.schedule].map((row) => row.sessionId);
  if (new Set(allSessions).size !== allSessions.length) throw new Error('generated session identifiers are not unique');
  return {
    schemaVersion: 'cortex.learning_os.private_utility_program.v0',
    validationId,
    generatedAt,
    status: 'preregistered',
    seed,
    seedSha256: sha256(seed),
    runtime: { provider: 'openai-codex', model, thinking, sandbox: 'read-only', ephemeral: true, toolsAllowed: false },
    design: {
      type: 'disjoint-calibration-then-clustered-paired-heldout-private-utility',
      calibrationModelCalls: calibration.schedule.length,
      holdoutModelCalls: holdout.schedule.length,
      maximumTotalModelCalls: calibration.schedule.length + holdout.schedule.length,
      noOutcomeDrivenSelectionOrReruns: true,
      clusterDefinition: 'one independent private fact with two paraphrased prompts; both prompts must pass for the arm to pass the fact cluster',
      continuationRule: 'run holdout only when the disjoint calibration headroom gate passes'
    },
    capsule,
    calibration,
    holdout,
    fixtureDisjointness: {
      lessonIdsDisjoint: true,
      factIdsDisjoint: true,
      conceptIdsDisjoint: true,
      ruleDigestsDisjoint: true,
      sharedAnswerValues: disjoint.sharedAnswers,
      note: 'Shared literal answers are disclosed but do not create fact/rule overlap; no calibration lesson or prompt is reused in holdout.'
    },
    truthBoundary: 'A pass supports only selective private-knowledge retrieval in shadow mode. It does not prove broad ordinary-task utility, autonomous learning, model-weight change, durability, or default-path approval.'
  };
}

function durationSeconds(trial) {
  if (!trial?.startedAt || !trial?.completedAt) return 0;
  const duration = (new Date(trial.completedAt).getTime() - new Date(trial.startedAt).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

export function analyzePrivateUtilityCalibration({ program, trials = [], generatedAt = new Date().toISOString() } = {}) {
  const rows = trials.filter((trial) => trial.phase === 'calibration');
  const itemByPair = new Map(program.calibration.items.map((item) => [item.pairId, item]));
  const resultByPair = new Map();
  for (const trial of rows) {
    if (!itemByPair.has(trial.pairId)) continue;
    if (resultByPair.has(trial.pairId)) throw new Error(`duplicate calibration trial: ${trial.pairId}`);
    resultByPair.set(trial.pairId, trial);
  }
  const validItems = [...resultByPair.values()].filter((trial) => trial.valid);
  const itemPasses = validItems.filter((trial) => trial.passed).length;
  const clusters = new Map();
  for (const item of program.calibration.items) {
    if (!clusters.has(item.clusterId)) clusters.set(item.clusterId, []);
    clusters.get(item.clusterId).push(resultByPair.get(item.pairId) || null);
  }
  let validClusters = 0;
  let passedClusters = 0;
  const clusterResults = [];
  for (const [clusterId, clusterTrials] of clusters) {
    const valid = clusterTrials.length === 2 && clusterTrials.every((trial) => trial?.valid);
    const passed = valid && clusterTrials.every((trial) => trial.passed);
    if (valid) validClusters += 1;
    if (passed) passedClusters += 1;
    clusterResults.push({ clusterId, valid, passed, trialIds: clusterTrials.map((trial) => trial?.trialId || null) });
  }
  const plannedItems = program.calibration.itemCount;
  const invalidItemRate = (plannedItems - validItems.length) / plannedItems;
  const itemAccuracy = validItems.length ? itemPasses / validItems.length : 0;
  const clusterAccuracy = validClusters ? passedClusters / validClusters : 0;
  const t = program.calibration.thresholds;
  const calibrationPass = validItems.length >= t.minimumValidItems
    && invalidItemRate <= t.maximumInvalidItemRate
    && itemAccuracy <= t.maximumNoPackItemAccuracy
    && clusterAccuracy <= t.maximumNoPackClusterAccuracy;
  return {
    schemaVersion: 'cortex.learning_os.private_utility_calibration_analysis.v0',
    validationId: program.validationId,
    generatedAt,
    plannedItems,
    validItems: validItems.length,
    invalidItems: plannedItems - validItems.length,
    invalidItemRate: round(invalidItemRate),
    itemPasses,
    noPackItemAccuracy: round(itemAccuracy),
    plannedClusters: clusters.size,
    validClusters,
    passedClusters,
    noPackClusterAccuracy: round(clusterAccuracy),
    thresholds: t,
    calibrationPass,
    decision: calibrationPass ? 'headroom_confirmed_proceed_to_frozen_holdout' : 'headroom_not_confirmed_stop_before_holdout',
    clusterResults,
    truthBoundary: calibrationPass
      ? 'The disjoint calibration pool confirms adequate no-pack headroom; it contributes no held-out efficacy wins.'
      : 'The calibration pool did not confirm adequate headroom. Stop before held-out calls and make no utility claim.'
  };
}

export function analyzePrivateUtilityHoldout({ program, trials = [], generatedAt = new Date().toISOString() } = {}) {
  const rows = trials.filter((trial) => trial.phase === 'holdout');
  const itemByPair = new Map(program.holdout.items.map((item) => [item.pairId, item]));
  const byPair = new Map(program.holdout.items.map((item) => [item.pairId, { pack: null, no_pack: null }]));
  for (const trial of rows) {
    const pair = byPair.get(trial.pairId);
    if (!pair || !ARMS.includes(trial.arm)) continue;
    if (pair[trial.arm]) throw new Error(`duplicate holdout trial: ${trial.pairId}/${trial.arm}`);
    pair[trial.arm] = trial;
  }
  let validItemPairs = 0;
  let itemBothPass = 0;
  let itemBothFail = 0;
  let itemPackOnly = 0;
  let itemNoPackOnly = 0;
  const itemPairResults = [];
  for (const [pairId, pair] of byPair) {
    const valid = Boolean(pair.pack?.valid && pair.no_pack?.valid);
    let outcome = 'invalid';
    if (valid) {
      validItemPairs += 1;
      if (pair.pack.passed && pair.no_pack.passed) { itemBothPass += 1; outcome = 'both_pass'; }
      else if (!pair.pack.passed && !pair.no_pack.passed) { itemBothFail += 1; outcome = 'both_fail'; }
      else if (pair.pack.passed) { itemPackOnly += 1; outcome = 'pack_only'; }
      else { itemNoPackOnly += 1; outcome = 'no_pack_only'; }
    }
    itemPairResults.push({ pairId, clusterId: itemByPair.get(pairId).clusterId, valid, outcome, packTrialId: pair.pack?.trialId || null, noPackTrialId: pair.no_pack?.trialId || null });
  }
  const clusterPairs = new Map();
  for (const item of program.holdout.items) {
    if (!clusterPairs.has(item.clusterId)) clusterPairs.set(item.clusterId, []);
    clusterPairs.get(item.clusterId).push(byPair.get(item.pairId));
  }
  let validClusters = 0;
  let bothPass = 0;
  let bothFail = 0;
  let packOnly = 0;
  let noPackOnly = 0;
  const clusterResults = [];
  for (const [clusterId, pairs] of clusterPairs) {
    const valid = pairs.length === 2 && pairs.every((pair) => pair.pack?.valid && pair.no_pack?.valid);
    const packPassed = valid && pairs.every((pair) => pair.pack.passed);
    const noPackPassed = valid && pairs.every((pair) => pair.no_pack.passed);
    let outcome = 'invalid';
    if (valid) {
      validClusters += 1;
      if (packPassed && noPackPassed) { bothPass += 1; outcome = 'both_pass'; }
      else if (!packPassed && !noPackPassed) { bothFail += 1; outcome = 'both_fail'; }
      else if (packPassed) { packOnly += 1; outcome = 'pack_only'; }
      else { noPackOnly += 1; outcome = 'no_pack_only'; }
    }
    clusterResults.push({ clusterId, valid, packPassed, noPackPassed, outcome });
  }
  const itemPackPasses = itemBothPass + itemPackOnly;
  const itemNoPackPasses = itemBothPass + itemNoPackOnly;
  const itemPackAccuracy = validItemPairs ? itemPackPasses / validItemPairs : 0;
  const itemNoPackAccuracy = validItemPairs ? itemNoPackPasses / validItemPairs : 0;
  const itemLift = itemPackAccuracy - itemNoPackAccuracy;
  const packClusterPasses = bothPass + packOnly;
  const noPackClusterPasses = bothPass + noPackOnly;
  const packClusterAccuracy = validClusters ? packClusterPasses / validClusters : 0;
  const noPackClusterAccuracy = validClusters ? noPackClusterPasses / validClusters : 0;
  const clusterLift = packClusterAccuracy - noPackClusterAccuracy;
  const invalidClusterRate = (program.holdout.clusterCount - validClusters) / program.holdout.clusterCount;
  const pValue = exactMcNemarP(packOnly, noPackOnly);
  const validTrials = rows.filter((trial) => trial.valid);
  const packTrials = validTrials.filter((trial) => trial.arm === 'pack');
  const noPackTrials = validTrials.filter((trial) => trial.arm === 'no_pack');
  const meanPackInputTokens = mean(packTrials.map((trial) => Number(trial.usage?.input_tokens || 0)));
  const meanNoPackInputTokens = mean(noPackTrials.map((trial) => Number(trial.usage?.input_tokens || 0)));
  const medianPackLatency = median(packTrials.map(durationSeconds));
  const medianNoPackLatency = median(noPackTrials.map(durationSeconds));
  const meanInputTokenOverhead = meanPackInputTokens - meanNoPackInputTokens;
  const medianLatencyOverheadSeconds = medianPackLatency - medianNoPackLatency;
  const maximumObservedPackTokens = Math.max(0, ...packTrials.map((trial) => Number(trial.retrievalPackEstimatedTokens || 0)));
  const t = program.holdout.thresholds;
  const validityGate = validItemPairs >= t.minimumValidItemPairs
    && validClusters >= t.minimumValidClusters
    && invalidClusterRate <= t.maximumInvalidClusterRate;
  const effectGate = itemPackAccuracy >= t.minimumPackItemAccuracy
    && packClusterAccuracy >= t.minimumPackClusterAccuracy
    && itemLift >= t.minimumItemAbsoluteLift
    && clusterLift >= t.minimumClusterAbsoluteLift
    && packOnly > noPackOnly
    && pValue <= t.alpha;
  const noRegressionGate = noPackOnly <= t.maximumNoPackOnlyClusters;
  const tokenCostGate = meanInputTokenOverhead <= t.maximumMeanInputTokenOverhead
    && maximumObservedPackTokens <= t.maximumRetrievalPackTokens;
  const latencyCostGate = medianLatencyOverheadSeconds <= t.maximumMedianLatencyOverheadSeconds;
  const holdoutPass = validityGate && effectGate && noRegressionGate && tokenCostGate && latencyCostGate;
  return {
    schemaVersion: 'cortex.learning_os.private_utility_holdout_analysis.v0',
    validationId: program.validationId,
    generatedAt,
    itemPairs: {
      planned: program.holdout.pairCount,
      valid: validItemPairs,
      invalid: program.holdout.pairCount - validItemPairs,
      bothPass: itemBothPass,
      bothFail: itemBothFail,
      packOnly: itemPackOnly,
      noPackOnly: itemNoPackOnly,
      packAccuracy: round(itemPackAccuracy),
      noPackAccuracy: round(itemNoPackAccuracy),
      absoluteLift: round(itemLift)
    },
    clusters: {
      planned: program.holdout.clusterCount,
      valid: validClusters,
      invalid: program.holdout.clusterCount - validClusters,
      invalidRate: round(invalidClusterRate),
      bothPass,
      bothFail,
      packOnly,
      noPackOnly,
      packAccuracy: round(packClusterAccuracy),
      noPackAccuracy: round(noPackClusterAccuracy),
      absoluteLift: round(clusterLift),
      discordant: packOnly + noPackOnly,
      exactMcNemarTwoSidedP: round(pValue, 9)
    },
    costs: {
      meanPackInputTokens: round(meanPackInputTokens, 2),
      meanNoPackInputTokens: round(meanNoPackInputTokens, 2),
      meanInputTokenOverhead: round(meanInputTokenOverhead, 2),
      medianPackLatencySeconds: round(medianPackLatency, 3),
      medianNoPackLatencySeconds: round(medianNoPackLatency, 3),
      medianLatencyOverheadSeconds: round(medianLatencyOverheadSeconds, 3),
      maximumObservedPackTokens
    },
    thresholds: t,
    gates: { validityGate, effectGate, noRegressionGate, tokenCostGate, latencyCostGate },
    holdoutPass,
    decision: holdoutPass ? 'go_selective_private_retrieval_shadow_candidate' : 'no_go_selective_private_retrieval_not_proven',
    allowedClaims: holdoutPass
      ? ['clustered_paired_private_utility_validation_completed', 'bounded_selective_private_retrieval_utility_under_declared_configuration']
      : ['clustered_paired_private_utility_validation_completed'],
    rejectedClaims: ['broad_ordinary_task_utility', 'autonomous_learning', 'model_weight_learning', 'durability', 'default_path_approval'],
    itemPairResults,
    clusterResults,
    truthBoundary: holdoutPass
      ? program.holdout.truthBoundary
      : 'The held-out program did not pass every frozen validity, effect, no-regression, token, and latency gate.'
  };
}
