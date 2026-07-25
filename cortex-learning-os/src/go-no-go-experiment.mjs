import crypto from 'node:crypto';
import { DeterministicRng, exactMcNemarP } from './ab-experiment.mjs';
import { SCHEMAS, validateRecord } from './contracts.mjs';

const ARMS = ['pack', 'no_pack'];

function sha256(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function capsule({ capsuleId, domain, activeExamIds = [], truthBoundary }) {
  const record = {
    schemaVersion: SCHEMAS.capsule,
    capsuleId,
    domain,
    version: '0.1.0',
    trustState: 'candidate',
    activeCurriculumId: `${capsuleId}-curriculum-v0`,
    activeExamIds,
    promotionThresholds: { minEvidence: 2, minDistinctExams: 2, minScore: 1, retestDays: 90 },
    truthBoundary
  };
  const validation = validateRecord(record);
  if (!validation.ok) throw new Error(`invalid generated capsule: ${validation.errors.join('; ')}`);
  return record;
}

function analysisPlan(pairCount) {
  return {
    primaryOutcome: 'deterministic exact-answer pass per trial',
    primaryEstimator: 'paired accuracy difference: pack minus no_pack over pairs with two valid trials',
    primaryTest: 'two-sided exact McNemar/binomial test over discordant valid pairs',
    minimumValidPairs: Math.min(24, pairCount),
    maximumInvalidPairRate: 0.1,
    minimumAbsoluteLift: 0.2,
    alpha: 0.05,
    maximumNoPackOnlyPairs: 1,
    maximumMeanInputTokenOverhead: 1200,
    maximumMedianLatencyOverheadSeconds: 10,
    maximumRetrievalPackTokens: 900,
    trackGate: 'effect gate, no-regression gate, token-cost gate, and latency-cost gate must all pass'
  };
}

function pairedSchedule({ programId, trackId, seed, items }) {
  const rng = new DeterministicRng(`${seed}:${trackId}:schedule:v1`);
  const pairOrder = rng.shuffle(items.map((item) => item.pairId));
  const schedule = [];
  for (const pairId of pairOrder) {
    const armOrder = rng.int(2) === 0 ? ARMS : [...ARMS].reverse();
    for (const arm of armOrder) {
      schedule.push({
        trackId,
        trackOrdinal: schedule.length + 1,
        pairId,
        arm,
        sessionId: `${programId}-${trackId}-${pairId}-${arm}-${sha256(`${seed}:${trackId}:${pairId}:${arm}:session:v1`).slice(0, 12)}`
      });
    }
  }
  return schedule;
}

function digitTuple(rng) {
  return Array.from({ length: 4 }, () => rng.int(10));
}

function transformAnswer(digits, rule) {
  const left = (digits.reduce((sum, digit, index) => sum + digit * rule.leftWeights[index], rule.leftBias) % rule.leftModulus);
  const right = (digits.reduce((sum, digit, index) => sum + digit * rule.rightWeights[index], rule.rightBias) % rule.rightModulus);
  return `${rule.answerPrefix}${String(left).padStart(2, '0')}-${String(right).padStart(2, '0')}`;
}

function mechanismItem({ pairNumber, digits, rule }) {
  const pairId = `pair-${String(pairNumber).padStart(3, '0')}`;
  return {
    pairId,
    itemId: `mechanism-${String(pairNumber).padStart(3, '0')}`,
    lessonId: null,
    prompt: `Apply private procedure ${rule.name} to input ${digits.join('-')}. Return only the resulting token.`,
    conceptIds: [rule.conceptId],
    answerFormat: `${rule.answerPrefix}NN-NN`,
    checker: { mode: 'exact_string', expected: transformAnswer(digits, rule), caseSensitive: true },
    generation: { inputDigest: sha256(digits), ruleDigest: rule.digest }
  };
}

export function buildMechanismTrack({ programId, seed, pairCount = 27, generatedAt }) {
  const rng = new DeterministicRng(`${seed}:mechanism:rule:v1`);
  const tag = sha256(`${seed}:mechanism:name:v1`).slice(0, 8).toUpperCase();
  const distinctWeights = (modulus) => {
    const values = [];
    while (values.length < 4) {
      const value = 2 + rng.int(modulus - 3);
      if (!values.includes(value)) values.push(value);
    }
    return values;
  };
  const rule = {
    name: `Qelvar-${tag}`,
    conceptId: `qelvar-${tag.toLowerCase()}`,
    answerPrefix: 'Q',
    leftWeights: distinctWeights(19),
    rightWeights: distinctWeights(17),
    leftBias: 3 + rng.int(31),
    rightBias: 5 + rng.int(29),
    leftModulus: 97,
    rightModulus: 89
  };
  rule.ruleText = `For ${rule.name}, parse the four decimal digits A-B-C-D. Compute L = (${rule.leftWeights[0]}A + ${rule.leftWeights[1]}B + ${rule.leftWeights[2]}C + ${rule.leftWeights[3]}D + ${rule.leftBias}) mod ${rule.leftModulus}. Compute R = (${rule.rightWeights[0]}A + ${rule.rightWeights[1]}B + ${rule.rightWeights[2]}C + ${rule.rightWeights[3]}D + ${rule.rightBias}) mod ${rule.rightModulus}. Return exactly QLL-RR with each residue zero-padded to two digits.`;
  rule.digest = sha256(rule.ruleText);

  const acquisitionRng = new DeterministicRng(`${seed}:mechanism:acquisition-items:v1`);
  const acquisitionInputs = [digitTuple(acquisitionRng), digitTuple(acquisitionRng), digitTuple(acquisitionRng)];
  const transferRng = new DeterministicRng(`${seed}:mechanism:transfer-items:v1`);
  const seen = new Set(acquisitionInputs.map((digits) => digits.join('')));
  const items = [];
  while (items.length < pairCount) {
    const digits = digitTuple(transferRng);
    const key = digits.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(mechanismItem({ pairNumber: items.length + 1, digits, rule }));
  }
  const baselineExamId = `${programId}-mechanism-acquisition-baseline-v0`;
  const correctionExamId = `${programId}-mechanism-acquisition-correction-v0`;
  const retestExamId = `${programId}-mechanism-acquisition-retest-v0`;
  const mechanismCapsule = capsule({
    capsuleId: `${programId}-mechanism-capsule-v0`,
    domain: 'synthetic-novel-procedure',
    activeExamIds: [baselineExamId, correctionExamId, retestExamId],
    truthBoundary: 'This capsule contains one seeded synthetic procedure unknown outside this frozen program; it cannot establish broad reasoning or domain learning.'
  });
  const acquisitionItems = acquisitionInputs.map((digits, index) => ({
    itemId: `mechanism-acquisition-${index + 1}`,
    prompt: `Apply private procedure ${rule.name} to input ${digits.join('-')}. Return only the resulting token.`,
    conceptIds: [rule.conceptId],
    answerFormat: `${rule.answerPrefix}NN-NN`,
    checker: { mode: 'exact_string', expected: transformAnswer(digits, rule), caseSensitive: true },
    mistakeCategory: 'missing_private_procedure',
    remediation: {
      correction: `Use the complete promoted ${rule.name} rule rather than guessing the token.`,
      lessonTemplate: {
        rule: rule.ruleText,
        contraindications: [`This rule applies only to ${rule.name}; do not reuse it for other named procedures.`]
      }
    }
  }));
  return {
    trackId: 'mechanism',
    title: 'Novel synthetic procedure acquisition and fresh-session transfer',
    pairCount,
    capsule: mechanismCapsule,
    rule,
    acquisition: {
      baselineExamId,
      correctionExamId,
      retestExamId,
      items: acquisitionItems,
      requiredOutcome: 'baseline fails; correction and independent retest pass; promotion gates pass'
    },
    items,
    schedule: pairedSchedule({ programId, trackId: 'mechanism', seed, items }),
    analysisPlan: analysisPlan(pairCount),
    intervention: {
      pack: 'A bounded retrieval pack built only from the lesson promoted during the frozen acquisition phase.',
      no_pack: 'No rule or learning context supplied.'
    },
    allowedClaimOnPass: 'bounded_fresh_session_retrieval_transfer_for_seeded_synthetic_procedure',
    truthBoundary: 'A pass proves only that the promoted synthetic procedure can be retrieved and applied in fresh sessions under this runtime.'
  };
}

export function validateUtilityFixture(fixture) {
  const errors = [];
  if (fixture?.schemaVersion !== 'cortex.learning_os.private_utility_fixture.v0') errors.push('unsupported fixture schema');
  if (!fixture?.fixtureId) errors.push('fixtureId is required');
  if (!Array.isArray(fixture?.lessons) || fixture.lessons.length < 2) errors.push('at least two lessons are required');
  if (!Array.isArray(fixture?.items) || fixture.items.length < 24) errors.push('at least 24 items are required');
  const lessons = new Map();
  for (const lesson of fixture?.lessons || []) {
    if (!lesson.lessonId || !lesson.conceptId || !lesson.rule || !lesson.sourceRef) errors.push('each lesson requires lessonId, conceptId, rule, and sourceRef');
    if (lessons.has(lesson.lessonId)) errors.push(`duplicate lessonId: ${lesson.lessonId}`);
    lessons.set(lesson.lessonId, lesson);
  }
  const itemIds = new Set();
  const coverage = new Map();
  for (const item of fixture?.items || []) {
    if (!item.itemId || !item.lessonId || !item.prompt || !['A', 'B', 'C', 'D'].includes(item.expected)) errors.push(`invalid utility item: ${item.itemId || '<missing>'}`);
    if (itemIds.has(item.itemId)) errors.push(`duplicate itemId: ${item.itemId}`);
    itemIds.add(item.itemId);
    if (!lessons.has(item.lessonId)) errors.push(`unknown lessonId for ${item.itemId}: ${item.lessonId}`);
    coverage.set(item.lessonId, (coverage.get(item.lessonId) || 0) + 1);
  }
  for (const lessonId of lessons.keys()) if ((coverage.get(lessonId) || 0) < 2) errors.push(`lesson has fewer than two items: ${lessonId}`);
  return { ok: errors.length === 0, errors };
}

function utilityTrustedLesson({ lesson, capsuleId, fixtureId, generatedAt }) {
  return {
    schemaVersion: SCHEMAS.trustedLesson,
    lessonId: lesson.lessonId,
    candidateId: `operator_curated_${sha256(`${fixtureId}:${lesson.lessonId}`).slice(0, 16)}`,
    capsuleId,
    conceptIds: [lesson.conceptId],
    rule: lesson.rule,
    contraindications: ['Apply only when the task explicitly concerns this named workspace policy or correction.'],
    promotionProof: {
      promoted: true,
      promotionMode: 'operator_curated_source_of_record',
      sourceRef: lesson.sourceRef,
      digest: sha256({ fixtureId, lessonId: lesson.lessonId, rule: lesson.rule, sourceRef: lesson.sourceRef }),
      truthBoundary: 'Operator curation establishes only that this is the declared workspace rule; the A/B test determines whether retrieval adds task utility.'
    },
    promotedAt: generatedAt,
    retestAfter: addDays(generatedAt, 90),
    sourceExamIds: [`${fixtureId}-source-of-record-review`]
  };
}

export function buildUtilityTrack({ programId, seed, fixture, generatedAt }) {
  const validation = validateUtilityFixture(fixture);
  if (!validation.ok) throw new Error(`invalid private utility fixture: ${validation.errors.join('; ')}`);
  const pairCount = fixture.items.length;
  const capsuleId = `${programId}-utility-capsule-v0`;
  const utilityCapsule = capsule({
    capsuleId,
    domain: 'private-workspace-operational-corrections',
    truthBoundary: 'This capsule is limited to low-sensitivity operator-curated workspace rules and contains no credentials or client-identifying facts.'
  });
  const trustedLessons = fixture.lessons.map((lesson) => utilityTrustedLesson({ lesson, capsuleId, fixtureId: fixture.fixtureId, generatedAt }));
  for (const lesson of trustedLessons) {
    const lessonValidation = validateRecord(lesson);
    if (!lessonValidation.ok) throw new Error(`invalid utility trusted lesson ${lesson.lessonId}: ${lessonValidation.errors.join('; ')}`);
  }
  const lessonById = new Map(fixture.lessons.map((lesson) => [lesson.lessonId, lesson]));
  const items = fixture.items.map((item, index) => {
    const lesson = lessonById.get(item.lessonId);
    return {
      pairId: `pair-${String(index + 1).padStart(3, '0')}`,
      itemId: item.itemId,
      lessonId: item.lessonId,
      prompt: item.prompt,
      conceptIds: [lesson.conceptId],
      answerFormat: 'one uppercase option letter: A, B, C, or D',
      checker: { mode: 'multiple_choice', expected: item.expected, caseSensitive: false }
    };
  });
  return {
    trackId: 'utility',
    title: 'Private workspace correction retrieval utility',
    pairCount,
    fixtureId: fixture.fixtureId,
    fixtureSha256: sha256(fixture),
    capsule: utilityCapsule,
    trustedLessons,
    items,
    schedule: pairedSchedule({ programId, trackId: 'utility', seed, items }),
    analysisPlan: analysisPlan(pairCount),
    intervention: {
      pack: 'A bounded retrieval pack containing only the item-matched operator-curated workspace lesson.',
      no_pack: 'No private workspace lesson or learning context supplied.'
    },
    allowedClaimOnPass: 'bounded_retrieval_utility_for_declared_private_workspace_corrections',
    truthBoundary: 'A pass proves only incremental retrieval utility for these low-sensitivity workspace corrections under this runtime.'
  };
}

export function buildGoNoGoProgram({
  programId,
  seed,
  utilityFixture,
  model = 'gpt-5.6-sol',
  thinking = 'low',
  generatedAt = new Date().toISOString()
} = {}) {
  if (!programId || !seed) throw new Error('programId and seed are required');
  const mechanism = buildMechanismTrack({ programId, seed, pairCount: 27, generatedAt });
  const utility = buildUtilityTrack({ programId, seed, fixture: utilityFixture, generatedAt });
  const scheduleRng = new DeterministicRng(`${seed}:program-interleave:v1`);
  const schedule = scheduleRng.shuffle([...mechanism.schedule, ...utility.schedule])
    .map((row, index) => ({ ...row, ordinal: index + 1 }));
  return {
    schemaVersion: 'cortex.learning_os.go_no_go_program.v0',
    programId,
    generatedAt,
    status: 'preregistered',
    seed,
    seedSha256: sha256(seed),
    runtime: { provider: 'openai-codex', model, thinking, sandbox: 'read-only', ephemeral: true, toolsAllowed: false },
    design: {
      type: 'two-track-preregistered-randomized-paired-fresh-session',
      tracks: ['mechanism', 'utility'],
      transferTrials: schedule.length,
      acquisitionTrials: 3,
      maximumTotalModelCalls: schedule.length + 3,
      noOutcomeDrivenReruns: true,
      programPassRule: 'mechanism acquisition promotes; mechanism track passes; utility track passes; both cost and no-regression gates pass'
    },
    tracks: { mechanism, utility },
    schedule,
    truthBoundary: 'A program pass supports only bounded retrieval transfer and utility for the two declared tracks. It does not prove broad learning, durability, autonomous self-improvement, model-weight change, or general mastery.'
  };
}

function durationSeconds(trial) {
  if (!trial.startedAt || !trial.completedAt) return 0;
  const duration = (new Date(trial.completedAt).getTime() - new Date(trial.startedAt).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

export function analyzeValidationTrack({ track, trials = [], generatedAt = new Date().toISOString() } = {}) {
  const byPair = new Map(track.items.map((item) => [item.pairId, { pack: null, no_pack: null }]));
  for (const trial of trials.filter((row) => row.trackId === track.trackId)) {
    const pair = byPair.get(trial.pairId);
    if (!pair || !ARMS.includes(trial.arm)) continue;
    if (pair[trial.arm]) throw new Error(`duplicate trial for ${track.trackId}/${trial.pairId}/${trial.arm}`);
    pair[trial.arm] = trial;
  }
  let bothPass = 0;
  let bothFail = 0;
  let packOnly = 0;
  let noPackOnly = 0;
  let invalidPairs = 0;
  const pairResults = [];
  for (const [pairId, pair] of byPair) {
    const valid = Boolean(pair.pack?.valid && pair.no_pack?.valid);
    let outcome = 'invalid';
    if (!valid) invalidPairs += 1;
    else if (pair.pack.passed && pair.no_pack.passed) { bothPass += 1; outcome = 'both_pass'; }
    else if (!pair.pack.passed && !pair.no_pack.passed) { bothFail += 1; outcome = 'both_fail'; }
    else if (pair.pack.passed) { packOnly += 1; outcome = 'pack_only'; }
    else { noPackOnly += 1; outcome = 'no_pack_only'; }
    pairResults.push({ pairId, valid, outcome, packTrialId: pair.pack?.trialId || null, noPackTrialId: pair.no_pack?.trialId || null });
  }
  const validPairs = track.pairCount - invalidPairs;
  const packPasses = bothPass + packOnly;
  const noPackPasses = bothPass + noPackOnly;
  const packAccuracy = validPairs ? packPasses / validPairs : 0;
  const noPackAccuracy = validPairs ? noPackPasses / validPairs : 0;
  const lift = packAccuracy - noPackAccuracy;
  const invalidPairRate = invalidPairs / track.pairCount;
  const pValue = exactMcNemarP(packOnly, noPackOnly);
  const plan = track.analysisPlan;
  const validTrials = trials.filter((row) => row.trackId === track.trackId && row.valid);
  const packTrials = validTrials.filter((row) => row.arm === 'pack');
  const noPackTrials = validTrials.filter((row) => row.arm === 'no_pack');
  const meanPackInputTokens = mean(packTrials.map((row) => Number(row.usage?.input_tokens || 0)));
  const meanNoPackInputTokens = mean(noPackTrials.map((row) => Number(row.usage?.input_tokens || 0)));
  const medianPackLatency = median(packTrials.map(durationSeconds));
  const medianNoPackLatency = median(noPackTrials.map(durationSeconds));
  const meanInputTokenOverhead = meanPackInputTokens - meanNoPackInputTokens;
  const medianLatencyOverheadSeconds = medianPackLatency - medianNoPackLatency;
  const maximumObservedPackTokens = Math.max(0, ...packTrials.map((row) => Number(row.retrievalPackEstimatedTokens || 0)));
  const effectGate = validPairs >= plan.minimumValidPairs
    && invalidPairRate <= plan.maximumInvalidPairRate
    && lift >= plan.minimumAbsoluteLift
    && packOnly > noPackOnly
    && pValue <= plan.alpha;
  const noRegressionGate = noPackOnly <= plan.maximumNoPackOnlyPairs;
  const tokenCostGate = meanInputTokenOverhead <= plan.maximumMeanInputTokenOverhead
    && maximumObservedPackTokens <= plan.maximumRetrievalPackTokens;
  const latencyCostGate = medianLatencyOverheadSeconds <= plan.maximumMedianLatencyOverheadSeconds;
  const trackPass = effectGate && noRegressionGate && tokenCostGate && latencyCostGate;
  return {
    schemaVersion: 'cortex.learning_os.go_no_go_track_analysis.v0',
    trackId: track.trackId,
    generatedAt,
    plannedPairs: track.pairCount,
    validPairs,
    invalidPairs,
    invalidPairRate: round(invalidPairRate),
    bothPass,
    bothFail,
    packOnly,
    noPackOnly,
    packPasses,
    noPackPasses,
    packAccuracy: round(packAccuracy),
    noPackAccuracy: round(noPackAccuracy),
    absoluteLift: round(lift),
    discordantPairs: packOnly + noPackOnly,
    exactMcNemarTwoSidedP: round(pValue, 9),
    meanPackInputTokens: round(meanPackInputTokens, 2),
    meanNoPackInputTokens: round(meanNoPackInputTokens, 2),
    meanInputTokenOverhead: round(meanInputTokenOverhead, 2),
    medianPackLatencySeconds: round(medianPackLatency, 3),
    medianNoPackLatencySeconds: round(medianNoPackLatency, 3),
    medianLatencyOverheadSeconds: round(medianLatencyOverheadSeconds, 3),
    maximumObservedPackTokens,
    gates: { effectGate, noRegressionGate, tokenCostGate, latencyCostGate },
    trackPass,
    allowedClaims: trackPass ? ['paired_randomized_experiment_completed', track.allowedClaimOnPass] : ['paired_randomized_experiment_completed'],
    pairResults,
    truthBoundary: trackPass
      ? track.truthBoundary
      : `The ${track.trackId} track completed but did not pass every preregistered effect, no-regression, and cost gate.`
  };
}

export function analyzeGoNoGoProgram({ program, trials = [], acquisition = null, generatedAt = new Date().toISOString() } = {}) {
  const mechanism = analyzeValidationTrack({ track: program.tracks.mechanism, trials, generatedAt });
  const utility = analyzeValidationTrack({ track: program.tracks.utility, trials, generatedAt });
  const acquisitionPromoted = acquisition?.promoted === true;
  const programPass = acquisitionPromoted && mechanism.trackPass && utility.trackPass;
  return {
    schemaVersion: 'cortex.learning_os.go_no_go_analysis.v0',
    programId: program.programId,
    generatedAt,
    acquisitionPromoted,
    tracks: { mechanism, utility },
    programPass,
    decision: programPass ? 'go_bounded_shadow_integration_candidate' : 'no_go_preserve_as_verified_memory_toolkit',
    allowedClaims: programPass
      ? ['two_track_preregistered_validation_completed', 'bounded_retrieval_mechanism_and_private_utility_replicated_under_declared_configuration']
      : ['two_track_preregistered_validation_completed'],
    rejectedClaims: ['broad_learning', 'durable_learning', 'autonomous_self_improvement', 'model_weight_learning', 'general_domain_mastery', 'default_path_approval'],
    truthBoundary: programPass
      ? 'Both preregistered tracks and their cost/no-regression gates passed. This supports only a bounded shadow-integration candidate; default routing and durability remain unapproved.'
      : 'The capped program did not pass every preregistered gate. Preserve the implementation as a verified memory/retrieval toolkit and do not promote default routing or broad Learning OS claims.'
  };
}
