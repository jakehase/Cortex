import crypto from 'node:crypto';
import { DeterministicRng, exactMcNemarP } from './ab-experiment.mjs';
import { SCHEMAS, validateRecord } from './contracts.mjs';

export const NOVEL_MATH_BENCHMARK_VERSION = 'cortex.learning_os.novel_math_benchmark.v0';
export const NOVEL_MATH_RESULT_VERSION = 'cortex.learning_os.novel_math_trial_result.v0';
const PAIRED_ARMS = ['pack', 'no_pack'];

const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
};

function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function durationSeconds(trial) {
  if (!trial?.startedAt || !trial?.completedAt) return 0;
  const duration = (new Date(trial.completedAt).getTime() - new Date(trial.startedAt).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function inputTokens(trial) {
  return Number(trial?.usage?.input_tokens ?? trial?.usage?.inputTokens ?? 0) || 0;
}

function makeCapsule({ validationId, theory, generatedAt }) {
  const baselineExamId = `${validationId}-acquisition-baseline-v0`;
  const correctionExamId = `${validationId}-acquisition-correction-v0`;
  const retestExamId = `${validationId}-acquisition-retest-v0`;
  const capsule = {
    schemaVersion: SCHEMAS.capsule,
    capsuleId: `${validationId}-novel-math-capsule-v0`,
    domain: 'seeded-novel-mathematical-microtheory',
    version: '0.1.0',
    trustState: 'candidate',
    activeCurriculumId: `${validationId}-novel-math-curriculum-v0`,
    activeExamIds: [baselineExamId, correctionExamId, retestExamId],
    promotionThresholds: { minEvidence: 2, minDistinctExams: 2, minScore: 1, retestDays: 90 },
    truthBoundary: `Frozen ${generatedAt}: one seeded invented pair algebra (${theory.name}); promotion cannot establish broad mathematics or model-weight learning.`
  };
  const validation = validateRecord(capsule);
  if (!validation.ok) throw new Error(`invalid novel-math capsule: ${validation.errors.join('; ')}`);
  return { capsule, baselineExamId, correctionExamId, retestExamId };
}

function distinctWeights(rng, count, maximumExclusive = 10) {
  const values = [];
  while (values.length < count) {
    const value = 2 + rng.int(maximumExclusive - 2);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

export function buildMicrotheory(seed, role = 'target') {
  const rng = new DeterministicRng(`${seed}:${role}:microtheory:v1`);
  const tag = sha256(`${seed}:${role}:name:v1`).slice(0, 10).toUpperCase();
  const combine = distinctWeights(rng, 6);
  const twist = distinctWeights(rng, 4);
  const theory = {
    name: `${role === 'calibration' ? 'Caldrin' : 'Aethryl'}-${tag}`,
    conceptId: `${role}-pair-algebra-${tag.toLowerCase()}`,
    leftModulus: [31, 37, 41][rng.int(3)],
    rightModulus: [29, 43, 47][rng.int(3)],
    combineWeights: combine,
    twistWeights: twist,
    combineBiases: [1 + rng.int(11), 1 + rng.int(13)],
    twistBiases: [1 + rng.int(7), 1 + rng.int(9)]
  };
  theory.ruleText = [
    `${theory.name} is a private invented algebra over ordered pairs of integers.`,
    `Normalize every result to nonnegative residues and print it as (LL,RR), with each coordinate zero-padded to two digits.`,
    `For P=(a,b) and Q=(c,d), define P ⊛ Q = ((w1*a + w2*c + w3*b*d + k1) mod ${theory.leftModulus}, (w4*b + w5*d + w6*a*c + k2) mod ${theory.rightModulus}), where (w1,w2,w3,w4,w5,w6)=(${combine.join(',')}) and (k1,k2)=(${theory.combineBiases.join(',')}).`,
    `Define τ(a,b) = ((u1*a + u2*b + t1) mod ${theory.leftModulus}, (u3*b + u4*a + t2) mod ${theory.rightModulus}), where (u1,u2,u3,u4)=(${twist.join(',')}) and (t1,t2)=(${theory.twistBiases.join(',')}).`,
    `Evaluate nested expressions from the innermost parentheses outward. ⊛ is not commutative or associative unless a particular calculation happens to coincide.`
  ].join(' ');
  theory.digest = sha256(theory.ruleText);
  return theory;
}

function pair(rng, maximumExclusive = 12) {
  return [rng.int(maximumExclusive), rng.int(maximumExclusive)];
}

function mod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function combinePair(left, right, theory) {
  const [a, b] = left;
  const [c, d] = right;
  const [w1, w2, w3, w4, w5, w6] = theory.combineWeights;
  return [
    mod(w1 * a + w2 * c + w3 * b * d + theory.combineBiases[0], theory.leftModulus),
    mod(w4 * b + w5 * d + w6 * a * c + theory.combineBiases[1], theory.rightModulus)
  ];
}

export function twistPair(value, theory) {
  const [a, b] = value;
  const [u1, u2, u3, u4] = theory.twistWeights;
  return [
    mod(u1 * a + u2 * b + theory.twistBiases[0], theory.leftModulus),
    mod(u3 * b + u4 * a + theory.twistBiases[1], theory.rightModulus)
  ];
}

function formatPair(value) {
  return `(${String(value[0]).padStart(2, '0')},${String(value[1]).padStart(2, '0')})`;
}

function pairText(value) {
  return `(${value[0]},${value[1]})`;
}

function mathItem({ validationId, trackId, index, theory, rng, shape }) {
  const itemId = `${trackId}-${String(index).padStart(3, '0')}`;
  let expression;
  let expected;
  if (shape === 'combine') {
    const left = pair(rng);
    const right = pair(rng);
    expression = `${pairText(left)} ⊛ ${pairText(right)}`;
    expected = combinePair(left, right, theory);
  } else if (shape === 'twist') {
    const value = pair(rng);
    expression = `τ${pairText(value)}`;
    expected = twistPair(value, theory);
  } else if (shape === 'twist_after_combine') {
    const left = pair(rng);
    const right = pair(rng);
    expression = `τ(${pairText(left)} ⊛ ${pairText(right)})`;
    expected = twistPair(combinePair(left, right, theory), theory);
  } else if (shape === 'combine_after_left_twist') {
    const left = pair(rng);
    const right = pair(rng);
    expression = `(τ${pairText(left)}) ⊛ ${pairText(right)}`;
    expected = combinePair(twistPair(left, theory), right, theory);
  } else if (shape === 'combine_after_right_twist') {
    const left = pair(rng);
    const right = pair(rng);
    expression = `${pairText(left)} ⊛ (τ${pairText(right)})`;
    expected = combinePair(left, twistPair(right, theory), theory);
  } else if (shape === 'nested_combine') {
    const first = pair(rng);
    const second = pair(rng);
    const third = pair(rng);
    expression = `(${pairText(first)} ⊛ ${pairText(second)}) ⊛ ${pairText(third)}`;
    expected = combinePair(combinePair(first, second, theory), third, theory);
  } else {
    throw new Error(`unsupported novel-math shape: ${shape}`);
  }
  return {
    pairId: `${trackId}-pair-${String(index).padStart(3, '0')}`,
    itemId,
    prompt: `In private mathematical microtheory ${theory.name}, evaluate ${expression}. Return only the normalized ordered pair.`,
    conceptIds: [theory.conceptId],
    answerFormat: '(NN,NN), exactly, with two decimal digits per coordinate',
    checker: { mode: 'exact_string', expected: formatPair(expected), caseSensitive: true },
    generation: { validationId, trackId, shape, expressionDigest: sha256(expression), theoryDigest: theory.digest }
  };
}

function uniqueMathItems({ validationId, trackId, count, theory, rng, shapeAt, seen = new Set() }) {
  const items = [];
  for (let index = 1; index <= count; index += 1) {
    let item = null;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const candidate = mathItem({ validationId, trackId, index, theory, rng, shape: shapeAt(index - 1) });
      if (seen.has(candidate.generation.expressionDigest)) continue;
      item = candidate;
      seen.add(candidate.generation.expressionDigest);
      break;
    }
    if (!item) throw new Error(`unable to generate unique expression for ${trackId}/${index}`);
    items.push(item);
  }
  return items;
}

function standardItem({ index, rng }) {
  const itemId = `regression-${String(index).padStart(3, '0')}`;
  const kind = index % 3;
  let prompt;
  let expected;
  if (kind === 0) {
    const left = 100_000 + rng.int(900_000);
    const right = 100_000 + rng.int(900_000);
    prompt = `Compute exactly using ordinary integer arithmetic: ${left} + ${right}.`;
    expected = BigInt(left) + BigInt(right);
  } else if (kind === 1) {
    const smaller = 10_000 + rng.int(90_000);
    const larger = smaller + 10_000 + rng.int(900_000);
    prompt = `Compute exactly using ordinary integer arithmetic: ${larger} − ${smaller}.`;
    expected = BigInt(larger) - BigInt(smaller);
  } else {
    const left = 100 + rng.int(900);
    const right = 10 + rng.int(90);
    prompt = `Compute exactly using ordinary integer arithmetic: ${left} × ${right}.`;
    expected = BigInt(left) * BigInt(right);
  }
  return {
    pairId: `regression-pair-${String(index).padStart(3, '0')}`,
    itemId,
    prompt,
    conceptIds: ['ordinary-integer-arithmetic'],
    answerFormat: 'integer only',
    checker: { mode: 'exact_integer_string', expected: expected.toString() },
    generation: { kind: ['addition', 'subtraction', 'multiplication'][kind], promptDigest: sha256(prompt) }
  };
}

function pairedSchedule({ validationId, seed, phase, trackId, items }) {
  const rng = new DeterministicRng(`${seed}:${phase}:${trackId}:schedule:v1`);
  const rows = [];
  for (const item of rng.shuffle(items)) {
    const arms = rng.int(2) === 0 ? PAIRED_ARMS : [...PAIRED_ARMS].reverse();
    for (const arm of arms) {
      rows.push({
        phase,
        trackId,
        pairId: item.pairId,
        arm,
        sessionId: `${validationId}-${phase}-${trackId}-${item.pairId}-${arm}-${sha256(`${seed}:${phase}:${trackId}:${item.pairId}:${arm}`).slice(0, 12)}`
      });
    }
  }
  return rng.shuffle(rows).map((row, index) => ({ ...row, trackOrdinal: index + 1 }));
}

function efficacyThresholds(pairCount, minimumPackAccuracy) {
  return {
    minimumValidPairs: Math.ceil(pairCount * 0.9),
    maximumInvalidPairRate: 0.1,
    minimumPackAccuracy,
    maximumNoPackAccuracy: 0.2,
    minimumAbsoluteLift: 0.5,
    alpha: 0.01,
    maximumNoPackOnlyPairs: 1,
    maximumMeanInputTokenOverhead: 1200,
    maximumMedianLatencyOverheadSeconds: 10,
    maximumRetrievalPackTokens: 900
  };
}

function buildAcquisition({ validationId, seed, theory, capsuleInfo }) {
  const rng = new DeterministicRng(`${seed}:target:acquisition-items:v1`);
  const shapes = ['combine', 'twist', 'twist_after_combine'];
  const items = uniqueMathItems({
    validationId,
    trackId: 'acquisition',
    count: shapes.length,
    theory,
    rng,
    shapeAt: (index) => shapes[index]
  }).map((item) => ({
    ...item,
    mistakeCategory: 'missing_private_mathematical_microtheory',
    remediation: {
      correction: `Use the complete promoted definition of ${theory.name}, including residue normalization and order of operations.`,
      lessonTemplate: {
        rule: theory.ruleText,
        contraindications: [`Apply this lesson only to expressions explicitly naming ${theory.name}; ordinary arithmetic and other named systems retain their standard definitions.`]
      }
    }
  }));
  return {
    baselineExamId: capsuleInfo.baselineExamId,
    correctionExamId: capsuleInfo.correctionExamId,
    retestExamId: capsuleInfo.retestExamId,
    items,
    requiredOutcome: 'baseline fails without the definition; correction and independent compositional retest pass with it; promotion gates pass'
  };
}

export function buildNovelMathProgram({
  validationId,
  seed,
  model = 'gpt-5.6-sol',
  thinking = 'xhigh',
  generatedAt = new Date().toISOString(),
  calibrationItems = 12,
  directPairs = 30,
  compositionPairs = 30,
  regressionPairs = 25,
  durabilityPairs = 20
} = {}) {
  if (!validationId || !seed) throw new Error('validationId and seed are required');
  const counts = { calibrationItems, directPairs, compositionPairs, regressionPairs, durabilityPairs };
  for (const [name, count] of Object.entries(counts)) {
    if (!Number.isInteger(count) || count < (name === 'calibrationItems' ? 4 : 8) || count > 100) throw new Error(`invalid ${name}: ${count}`);
  }
  const calibrationTheory = buildMicrotheory(seed, 'calibration');
  const targetTheory = buildMicrotheory(seed, 'target');
  if (calibrationTheory.digest === targetTheory.digest || calibrationTheory.name === targetTheory.name) throw new Error('calibration and target theories must be disjoint');
  const capsuleInfo = makeCapsule({ validationId, theory: targetTheory, generatedAt });
  const acquisition = buildAcquisition({ validationId, seed, theory: targetTheory, capsuleInfo });
  const targetExpressionDigests = new Set(acquisition.items.map((item) => item.generation.expressionDigest));
  const calibrationRng = new DeterministicRng(`${seed}:calibration:items:v1`);
  const calibrationShapes = ['combine', 'twist', 'twist_after_combine', 'combine_after_left_twist'];
  const calibration = {
    theory: calibrationTheory,
    items: uniqueMathItems({
      validationId,
      trackId: 'calibration',
      count: calibrationItems,
      theory: calibrationTheory,
      rng: calibrationRng,
      shapeAt: (index) => calibrationShapes[index % calibrationShapes.length]
    })
  };
  const calibrationScheduleRng = new DeterministicRng(`${seed}:calibration:schedule:v1`);
  calibration.schedule = calibrationScheduleRng.shuffle(calibration.items).map((item, index) => ({
    phase: 'calibration',
    trackId: 'calibration',
    ordinal: index + 1,
    pairId: item.pairId,
    arm: 'no_pack',
    sessionId: `${validationId}-calibration-${item.pairId}-${sha256(`${seed}:calibration:${item.pairId}`).slice(0, 12)}`
  }));
  calibration.thresholds = {
    minimumValidItems: Math.ceil(calibrationItems * 0.9),
    maximumInvalidItemRate: 0.1,
    maximumNoPackAccuracy: 0.2
  };
  calibration.truthBoundary = 'A disjoint invented microtheory checks no-context headroom only. Its outcomes cannot contribute target-theory efficacy wins.';

  const directRng = new DeterministicRng(`${seed}:target:direct-items:v1`);
  const directItems = uniqueMathItems({
    validationId,
    trackId: 'direct',
    count: directPairs,
    theory: targetTheory,
    rng: directRng,
    shapeAt: (index) => index % 2 === 0 ? 'combine' : 'twist',
    seen: targetExpressionDigests
  });
  const compositionRng = new DeterministicRng(`${seed}:target:composition-items:v1`);
  const compositionShapes = ['twist_after_combine', 'combine_after_left_twist', 'combine_after_right_twist', 'nested_combine'];
  const compositionItems = uniqueMathItems({
    validationId,
    trackId: 'composition',
    count: compositionPairs,
    theory: targetTheory,
    rng: compositionRng,
    shapeAt: (index) => compositionShapes[index % compositionShapes.length],
    seen: targetExpressionDigests
  });
  const regressionRng = new DeterministicRng(`${seed}:regression:items:v1`);
  const regressionItems = Array.from({ length: regressionPairs }, (_, index) => standardItem({ index: index + 1, rng: regressionRng }));
  const durabilityRng = new DeterministicRng(`${seed}:target:durability-items:v1`);
  const durabilityItems = uniqueMathItems({
    validationId,
    trackId: 'durability',
    count: durabilityPairs,
    theory: targetTheory,
    rng: durabilityRng,
    shapeAt: (index) => compositionShapes[(index + 1) % compositionShapes.length],
    seen: targetExpressionDigests
  });

  const tracks = {
    direct: {
      trackId: 'direct',
      title: 'Fresh-session direct application of a promoted novel pair algebra',
      items: directItems,
      pairCount: directPairs,
      schedule: pairedSchedule({ validationId, seed, phase: 'immediate', trackId: 'direct', items: directItems }),
      thresholds: efficacyThresholds(directPairs, 0.85),
      truthBoundary: 'A pass supports bounded direct application only for this seeded invented microtheory.'
    },
    composition: {
      trackId: 'composition',
      title: 'Fresh-session compositional generalization beyond acquisition examples',
      items: compositionItems,
      pairCount: compositionPairs,
      schedule: pairedSchedule({ validationId, seed, phase: 'immediate', trackId: 'composition', items: compositionItems }),
      thresholds: efficacyThresholds(compositionPairs, 0.8),
      truthBoundary: 'A pass supports bounded compositional transfer to these disjoint expression forms, not general mathematical mastery.'
    },
    regression: {
      trackId: 'regression',
      title: 'Ordinary-math non-interference under deliberately irrelevant retrieval context',
      items: regressionItems,
      pairCount: regressionPairs,
      schedule: pairedSchedule({ validationId, seed, phase: 'immediate', trackId: 'regression', items: regressionItems }),
      thresholds: {
        minimumValidPairs: Math.ceil(regressionPairs * 0.9),
        maximumInvalidPairRate: 0.1,
        minimumPackAccuracy: 0.96,
        maximumAbsoluteAccuracyHarm: 0.02,
        maximumNoPackOnlyPairs: 1,
        maximumRetrievalPackTokens: 900
      },
      truthBoundary: 'The pack arm deliberately supplies an irrelevant novel-theory lesson as a conservative interference stress; normal selective routing should omit it.'
    },
    durability: {
      trackId: 'durability',
      title: 'Paired novel-math transfer after a clean runner process restart',
      items: durabilityItems,
      pairCount: durabilityPairs,
      schedule: pairedSchedule({ validationId, seed, phase: 'post_restart', trackId: 'durability', items: durabilityItems }),
      thresholds: efficacyThresholds(durabilityPairs, 0.85),
      truthBoundary: 'A pass proves artifact-backed retrieval across one clean runner process boundary, not long-term human-like memory or model-weight persistence.'
    }
  };
  const immediateScheduleRng = new DeterministicRng(`${seed}:immediate:interleave:v1`);
  const immediateSchedule = immediateScheduleRng.shuffle([
    ...tracks.direct.schedule,
    ...tracks.composition.schedule,
    ...tracks.regression.schedule
  ]).map((row, index) => ({ ...row, ordinal: index + 1 }));
  const durabilitySchedule = tracks.durability.schedule.map((row, index) => ({ ...row, ordinal: index + 1 }));
  const allItems = [
    ...calibration.items,
    ...acquisition.items,
    ...directItems,
    ...compositionItems,
    ...regressionItems,
    ...durabilityItems
  ];
  const itemIds = allItems.map((item) => item.itemId);
  if (new Set(itemIds).size !== itemIds.length) throw new Error('generated item identifiers are not unique');
  const acquisitionExpressionDigests = new Set(acquisition.items.map((item) => item.generation.expressionDigest));
  for (const item of [...directItems, ...compositionItems, ...durabilityItems]) {
    if (acquisitionExpressionDigests.has(item.generation.expressionDigest)) throw new Error(`held-out expression overlaps acquisition: ${item.itemId}`);
  }
  const targetHeldoutDigests = [...directItems, ...compositionItems, ...durabilityItems].map((item) => item.generation.expressionDigest);
  if (new Set(targetHeldoutDigests).size !== targetHeldoutDigests.length) throw new Error('target held-out expressions are not unique');
  const maximumTotalModelCalls = calibrationItems + 3 + immediateSchedule.length + durabilitySchedule.length;
  const sessionIds = [
    ...calibration.schedule.map((row) => row.sessionId),
    ...immediateSchedule.map((row) => row.sessionId),
    ...durabilitySchedule.map((row) => row.sessionId),
    ...['baseline', 'correction', 'retest'].map((role) => `${validationId}-acquisition-${role}-${sha256(`${seed}:acquisition:${role}`).slice(0, 12)}`)
  ];
  if (new Set(sessionIds).size !== sessionIds.length) throw new Error('generated session identifiers are not unique');

  return {
    schemaVersion: NOVEL_MATH_BENCHMARK_VERSION,
    validationId,
    generatedAt,
    status: 'preregistered',
    seed,
    seedSha256: sha256(seed),
    runtime: { provider: 'openai-codex', model, thinking, sandbox: 'read-only', ephemeral: true, toolsAllowed: false, workerCommand: 'codex' },
    design: {
      type: 'disjoint-headroom-acquisition-randomized-paired-transfer-regression-process-restart',
      calibrationModelCalls: calibrationItems,
      acquisitionModelCalls: 3,
      immediateModelCalls: immediateSchedule.length,
      postRestartModelCalls: durabilitySchedule.length,
      maximumTotalModelCalls,
      freshSessionPerTrial: true,
      sameItemAcrossPairedArms: true,
      noOutcomeDrivenReruns: true,
      restartRequirement: 'Immediate phase exits after persisting the promoted lesson and checkpoint. A separate Node process must reload both artifacts before post-restart trials.',
      stopCondition: 'calibration_or_acquisition_early_no_go; otherwise all frozen trials complete and independent artifact verification determines thresholdPass'
    },
    capsule: capsuleInfo.capsule,
    calibration,
    targetTheory: {
      ...targetTheory,
      truthBoundary: 'The definition is generated before calls and exposed only through correction/retest or the promoted retrieval pack.'
    },
    acquisition,
    tracks,
    immediateSchedule,
    durabilitySchedule,
    allowedClaimOnPass: 'bounded_acquisition_retention_and_fresh_session_generalization_for_one_seeded_novel_mathematical_microtheory',
    truthBoundary: 'A pass proves a bounded retrieval-mediated Learning OS result for one seeded invented mathematical microtheory under the declared model/runtime. It does not prove broad math improvement, human-like durable learning, autonomous self-improvement, or model-weight change.'
  };
}

export function analyzeNovelMathCalibration({ program, trials = [], generatedAt = new Date().toISOString() } = {}) {
  const expectedIds = new Set(program.calibration.items.map((item) => item.itemId));
  const rows = trials.filter((trial) => trial.phase === 'calibration' && expectedIds.has(trial.itemId));
  const unique = new Map();
  for (const trial of rows) {
    if (unique.has(trial.itemId)) throw new Error(`duplicate calibration trial: ${trial.itemId}`);
    unique.set(trial.itemId, trial);
  }
  const valid = [...unique.values()].filter((trial) => trial.valid);
  const passes = valid.filter((trial) => trial.passed).length;
  const plannedItems = program.calibration.items.length;
  const invalidItemRate = (plannedItems - valid.length) / plannedItems;
  const noPackAccuracy = valid.length ? passes / valid.length : 0;
  const t = program.calibration.thresholds;
  const calibrationPass = valid.length >= t.minimumValidItems
    && invalidItemRate <= t.maximumInvalidItemRate
    && noPackAccuracy <= t.maximumNoPackAccuracy;
  return {
    schemaVersion: 'cortex.learning_os.novel_math_calibration_analysis.v0',
    validationId: program.validationId,
    generatedAt,
    plannedItems,
    validItems: valid.length,
    invalidItems: plannedItems - valid.length,
    invalidItemRate: round(invalidItemRate),
    noPackPasses: passes,
    noPackAccuracy: round(noPackAccuracy),
    thresholds: t,
    calibrationPass,
    decision: calibrationPass ? 'headroom_confirmed_proceed' : 'headroom_not_confirmed_stop',
    truthBoundary: calibrationPass
      ? 'Disjoint no-context calibration confirmed headroom; it contributes no target-theory wins.'
      : 'Headroom was not confirmed, so target-theory acquisition and efficacy must not be interpreted.'
  };
}

function pairedCounts(track, trials) {
  const byPair = new Map(track.items.map((item) => [item.pairId, { pack: null, no_pack: null }]));
  for (const trial of trials.filter((row) => row.trackId === track.trackId)) {
    const pairRecord = byPair.get(trial.pairId);
    if (!pairRecord || !PAIRED_ARMS.includes(trial.arm)) continue;
    if (pairRecord[trial.arm]) throw new Error(`duplicate trial for ${track.trackId}/${trial.pairId}/${trial.arm}`);
    pairRecord[trial.arm] = trial;
  }
  let bothPass = 0;
  let bothFail = 0;
  let packOnly = 0;
  let noPackOnly = 0;
  let invalidPairs = 0;
  const pairResults = [];
  const validTrials = [];
  for (const [pairId, pairRecord] of byPair) {
    const valid = Boolean(pairRecord.pack?.valid && pairRecord.no_pack?.valid);
    let outcome = 'invalid';
    if (!valid) invalidPairs += 1;
    else {
      validTrials.push(pairRecord.pack, pairRecord.no_pack);
      if (pairRecord.pack.passed && pairRecord.no_pack.passed) { bothPass += 1; outcome = 'both_pass'; }
      else if (!pairRecord.pack.passed && !pairRecord.no_pack.passed) { bothFail += 1; outcome = 'both_fail'; }
      else if (pairRecord.pack.passed) { packOnly += 1; outcome = 'pack_only'; }
      else { noPackOnly += 1; outcome = 'no_pack_only'; }
    }
    pairResults.push({ pairId, valid, outcome, packTrialId: pairRecord.pack?.trialId || null, noPackTrialId: pairRecord.no_pack?.trialId || null });
  }
  const validPairs = track.pairCount - invalidPairs;
  const packPasses = bothPass + packOnly;
  const noPackPasses = bothPass + noPackOnly;
  const packAccuracy = validPairs ? packPasses / validPairs : 0;
  const noPackAccuracy = validPairs ? noPackPasses / validPairs : 0;
  const packTrials = validTrials.filter((trial) => trial.arm === 'pack');
  const noPackTrials = validTrials.filter((trial) => trial.arm === 'no_pack');
  return {
    validPairs,
    invalidPairs,
    invalidPairRate: invalidPairs / track.pairCount,
    bothPass,
    bothFail,
    packOnly,
    noPackOnly,
    packPasses,
    noPackPasses,
    packAccuracy,
    noPackAccuracy,
    absoluteLift: packAccuracy - noPackAccuracy,
    exactP: exactMcNemarP(packOnly, noPackOnly),
    meanInputTokenOverhead: mean(packTrials.map(inputTokens)) - mean(noPackTrials.map(inputTokens)),
    medianLatencyOverheadSeconds: median(packTrials.map(durationSeconds)) - median(noPackTrials.map(durationSeconds)),
    maxObservedRetrievalPackTokens: Math.max(0, ...packTrials.map((trial) => Number(trial.retrievalPackEstimatedTokens || 0))),
    pairResults
  };
}

export function analyzeNovelMathEfficacyTrack({ track, trials = [], generatedAt = new Date().toISOString() } = {}) {
  const counts = pairedCounts(track, trials);
  const t = track.thresholds;
  const gates = {
    completionGate: counts.validPairs >= t.minimumValidPairs && counts.invalidPairRate <= t.maximumInvalidPairRate,
    packAccuracyGate: counts.packAccuracy >= t.minimumPackAccuracy,
    headroomGate: counts.noPackAccuracy <= t.maximumNoPackAccuracy,
    liftGate: counts.absoluteLift >= t.minimumAbsoluteLift,
    significanceGate: counts.packOnly > counts.noPackOnly && counts.exactP <= t.alpha,
    noRegressionGate: counts.noPackOnly <= t.maximumNoPackOnlyPairs,
    tokenCostGate: counts.meanInputTokenOverhead <= t.maximumMeanInputTokenOverhead && counts.maxObservedRetrievalPackTokens <= t.maximumRetrievalPackTokens,
    latencyCostGate: counts.medianLatencyOverheadSeconds <= t.maximumMedianLatencyOverheadSeconds
  };
  const trackPass = Object.values(gates).every(Boolean);
  return {
    schemaVersion: 'cortex.learning_os.novel_math_efficacy_analysis.v0',
    trackId: track.trackId,
    generatedAt,
    plannedPairs: track.pairCount,
    validPairs: counts.validPairs,
    invalidPairs: counts.invalidPairs,
    invalidPairRate: round(counts.invalidPairRate),
    bothPass: counts.bothPass,
    bothFail: counts.bothFail,
    packOnly: counts.packOnly,
    noPackOnly: counts.noPackOnly,
    packAccuracy: round(counts.packAccuracy),
    noPackAccuracy: round(counts.noPackAccuracy),
    absoluteLift: round(counts.absoluteLift),
    exactMcNemarTwoSidedP: round(counts.exactP, 9),
    meanInputTokenOverhead: round(counts.meanInputTokenOverhead),
    medianLatencyOverheadSeconds: round(counts.medianLatencyOverheadSeconds),
    maxObservedRetrievalPackTokens: counts.maxObservedRetrievalPackTokens,
    thresholds: t,
    gates,
    trackPass,
    pairResults: counts.pairResults,
    truthBoundary: track.truthBoundary
  };
}

export function analyzeNovelMathRegression({ track, trials = [], generatedAt = new Date().toISOString() } = {}) {
  const counts = pairedCounts(track, trials);
  const t = track.thresholds;
  const accuracyHarm = counts.noPackAccuracy - counts.packAccuracy;
  const gates = {
    completionGate: counts.validPairs >= t.minimumValidPairs && counts.invalidPairRate <= t.maximumInvalidPairRate,
    packAccuracyGate: counts.packAccuracy >= t.minimumPackAccuracy,
    nonInterferenceGate: accuracyHarm <= t.maximumAbsoluteAccuracyHarm && counts.noPackOnly <= t.maximumNoPackOnlyPairs,
    packBoundGate: counts.maxObservedRetrievalPackTokens <= t.maximumRetrievalPackTokens
  };
  const regressionPass = Object.values(gates).every(Boolean);
  return {
    schemaVersion: 'cortex.learning_os.novel_math_regression_analysis.v0',
    trackId: track.trackId,
    generatedAt,
    plannedPairs: track.pairCount,
    validPairs: counts.validPairs,
    invalidPairs: counts.invalidPairs,
    invalidPairRate: round(counts.invalidPairRate),
    bothPass: counts.bothPass,
    bothFail: counts.bothFail,
    packOnly: counts.packOnly,
    noPackOnly: counts.noPackOnly,
    packAccuracy: round(counts.packAccuracy),
    noPackAccuracy: round(counts.noPackAccuracy),
    absoluteAccuracyHarm: round(accuracyHarm),
    maxObservedRetrievalPackTokens: counts.maxObservedRetrievalPackTokens,
    thresholds: t,
    gates,
    regressionPass,
    pairResults: counts.pairResults,
    truthBoundary: track.truthBoundary
  };
}

export function analyzeRestartIntegrity({ checkpoint, durabilityInvocation, trustedLessonSha256 } = {}) {
  const distinctProcess = Boolean(checkpoint?.processNonce && durabilityInvocation?.processNonce && checkpoint.processNonce !== durabilityInvocation.processNonce);
  const lessonDigestStable = Boolean(checkpoint?.trustedLessonSha256 && trustedLessonSha256 && checkpoint.trustedLessonSha256 === trustedLessonSha256);
  const immediateExitedFirst = Boolean(checkpoint?.completedAt && durabilityInvocation?.startedAt && new Date(durabilityInvocation.startedAt) >= new Date(checkpoint.completedAt));
  const restartIntegrityPass = distinctProcess && lessonDigestStable && immediateExitedFirst;
  return {
    schemaVersion: 'cortex.learning_os.novel_math_restart_integrity.v0',
    distinctProcess,
    immediateProcessId: checkpoint?.processId ?? null,
    durabilityProcessId: durabilityInvocation?.processId ?? null,
    lessonDigestStable,
    immediateExitedFirst,
    restartIntegrityPass,
    truthBoundary: restartIntegrityPass
      ? 'The durability phase ran in a distinct runner invocation and reloaded an unchanged promoted lesson from disk.'
      : 'A clean artifact-backed process restart was not proven; no durability-across-restart claim is allowed.'
  };
}

export function analyzeNovelMathProgram({
  program,
  calibrationTrials = [],
  acquisition = {},
  immediateTrials = [],
  durabilityTrials = [],
  checkpoint = null,
  durabilityInvocation = null,
  trustedLessonSha256 = null,
  generatedAt = new Date().toISOString()
} = {}) {
  const calibration = analyzeNovelMathCalibration({ program, trials: calibrationTrials, generatedAt });
  const direct = analyzeNovelMathEfficacyTrack({ track: program.tracks.direct, trials: immediateTrials, generatedAt });
  const composition = analyzeNovelMathEfficacyTrack({ track: program.tracks.composition, trials: immediateTrials, generatedAt });
  const regression = analyzeNovelMathRegression({ track: program.tracks.regression, trials: immediateTrials, generatedAt });
  const durability = analyzeNovelMathEfficacyTrack({ track: program.tracks.durability, trials: durabilityTrials, generatedAt });
  const restartIntegrity = analyzeRestartIntegrity({ checkpoint, durabilityInvocation, trustedLessonSha256 });
  const acquisitionPass = acquisition?.promoted === true
    && acquisition?.baselineFailed === true
    && acquisition?.correctionPassed === true
    && acquisition?.retestPassed === true;
  const acquisitionTrials = Array.isArray(acquisition?.trials) ? acquisition.trials : [];
  const allTrials = [...calibrationTrials, ...acquisitionTrials, ...immediateTrials, ...durabilityTrials];
  const completedModelCalls = calibrationTrials.length + Number(acquisition?.modelCalls || 0) + immediateTrials.length + durabilityTrials.length;
  const trialRecordsComplete = allTrials.length === completedModelCalls && allTrials.every((trial) =>
    trial?.schemaVersion === NOVEL_MATH_RESULT_VERSION
    && typeof trial.trialId === 'string'
    && typeof trial.sessionId === 'string'
    && typeof trial.valid === 'boolean'
  );
  const positiveRuntimeCount = allTrials.filter((trial) =>
    trial?.startedAt && trial?.completedAt && new Date(trial.completedAt) > new Date(trial.startedAt)
  ).length;
  const providerMatchedCount = allTrials.filter((trial) => trial?.provider === program.runtime.provider).length;
  const modelMatchedCount = allTrials.filter((trial) => trial?.model === program.runtime.model).length;
  const providerUsageCount = allTrials.filter((trial) => {
    const input = Number(trial?.usage?.input_tokens ?? trial?.usage?.inputTokens ?? 0);
    const output = Number(trial?.usage?.output_tokens ?? trial?.usage?.outputTokens ?? 0);
    return input > 0 && output > 0;
  }).length;
  const workerProvenance = program.runtime.workerProvenance || {};
  const workerCommandPass = program.runtime.workerCommand === 'codex'
    && workerProvenance.command === 'codex'
    && workerProvenance.explicitOverride === false
    && workerProvenance.claimable === true
    && typeof workerProvenance.executableSha256 === 'string'
    && /^[0-9a-f]{64}$/.test(workerProvenance.executableSha256)
    && /^codex-cli\s+\d+\.\d+\.\d+/.test(workerProvenance.version || '');
  const providerEvidence = {
    workerCommand: program.runtime.workerCommand,
    workerProvenance,
    workerCommandPass,
    observedCallRecords: allTrials.length,
    positiveRuntimeCount,
    providerMatchedCount,
    modelMatchedCount,
    providerUsageCount,
    realModelWorkPass: workerCommandPass
      && allTrials.length === program.design.maximumTotalModelCalls
      && positiveRuntimeCount === allTrials.length
      && providerMatchedCount === allTrials.length
      && modelMatchedCount === allTrials.length
      && providerUsageCount === allTrials.length,
    truthBoundary: 'A real-model-work claim requires the frozen Codex worker command, positive per-call runtime, matching provider/model metadata, and positive provider-observed input and output tokens for every planned call.'
  };
  const mechanicalGreen = completedModelCalls === program.design.maximumTotalModelCalls && trialRecordsComplete;
  const frozenOutcomePass = mechanicalGreen
    && calibration.calibrationPass
    && acquisitionPass
    && direct.trackPass
    && composition.trackPass
    && regression.regressionPass
    && durability.trackPass
    && restartIntegrity.restartIntegrityPass;
  const thresholdPass = frozenOutcomePass && providerEvidence.realModelWorkPass;
  return {
    schemaVersion: 'cortex.learning_os.novel_math_final_analysis.v0',
    validationId: program.validationId,
    generatedAt,
    benchmarkVersion: program.schemaVersion,
    completedModelCalls,
    plannedModelCalls: program.design.maximumTotalModelCalls,
    mechanicalGreen,
    calibration,
    acquisition: {
      valid: acquisition?.valid === true,
      baselineFailed: acquisition?.baselineFailed === true,
      correctionPassed: acquisition?.correctionPassed === true,
      retestPassed: acquisition?.retestPassed === true,
      promoted: acquisition?.promoted === true,
      acquisitionPass
    },
    tracks: { direct, composition, regression, durability },
    restartIntegrity,
    providerEvidence,
    frozenOutcomePass,
    thresholdPass,
    decision: thresholdPass
      ? 'pass_bounded_novel_math_learning_and_restart_transfer'
      : frozenOutcomePass
        ? 'nonclaimable_worker_override'
        : 'no_go_math_section_not_production_qualified',
    allowedClaims: thresholdPass
      ? ['preregistered_novel_math_benchmark_completed', program.allowedClaimOnPass]
      : frozenOutcomePass
        ? ['synthetic_harness_validation_completed']
        : ['preregistered_novel_math_benchmark_completed'],
    rejectedClaims: ['broad_math_improvement', 'general_domain_mastery', 'human_like_durable_learning', 'autonomous_self_improvement', 'model_weight_learning'],
    truthBoundary: thresholdPass
      ? program.truthBoundary
      : 'The frozen benchmark did not meet every mechanical, efficacy, regression, and restart gate. Do not claim that the math section is production-qualified.'
  };
}

export function buildOperatorCuratedLesson({ program, generatedAt = program.generatedAt } = {}) {
  const record = {
    schemaVersion: SCHEMAS.trustedLesson,
    lessonId: `${program.validationId}-test-lesson`,
    candidateId: `${program.validationId}-test-candidate`,
    capsuleId: program.capsule.capsuleId,
    conceptIds: [program.targetTheory.conceptId],
    rule: program.targetTheory.ruleText,
    contraindications: [`Apply only to ${program.targetTheory.name}.`],
    promotionProof: {
      promoted: true,
      mode: 'unit_test_only',
      digest: sha256(program.targetTheory.ruleText),
      truthBoundary: 'Unit-test helper; real benchmark promotion must come from acquisition evidence.'
    },
    promotedAt: generatedAt,
    retestAfter: addDays(generatedAt, 90),
    sourceExamIds: [program.acquisition.correctionExamId, program.acquisition.retestExamId]
  };
  const validation = validateRecord(record);
  if (!validation.ok) throw new Error(`invalid test lesson: ${validation.errors.join('; ')}`);
  return record;
}
