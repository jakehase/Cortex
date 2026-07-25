import crypto from 'node:crypto';

const ARMS = ['pack', 'no_pack'];

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

export class DeterministicRng {
  constructor(seed) {
    if (!seed || !String(seed).trim()) throw new Error('a non-empty seed is required');
    this.seed = String(seed);
    this.counter = 0;
  }

  uint64() {
    const digest = crypto.createHash('sha256').update(`${this.seed}:${this.counter++}`).digest();
    return digest.readBigUInt64BE(0);
  }

  int(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive must be a positive safe integer');
    const modulus = BigInt(maxExclusive);
    const range = 1n << 64n;
    const limit = range - (range % modulus);
    let value = this.uint64();
    while (value >= limit) value = this.uint64();
    return Number(value % modulus);
  }

  shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(index + 1);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
}

function decimalWithDigits(rng, digits) {
  if (!Number.isInteger(digits) || digits < 1) throw new Error('digits must be a positive integer');
  let value = String(1 + rng.int(9));
  for (let index = 1; index < digits; index += 1) value += String(rng.int(10));
  return value;
}

function buildItem(pairNumber, rng, { leftDigits, rightDigits } = {}) {
  const left = decimalWithDigits(rng, leftDigits);
  const right = decimalWithDigits(rng, rightDigits);
  const expected = (BigInt(left) * BigInt(right)).toString();
  const pairId = `pair-${String(pairNumber).padStart(3, '0')}`;
  return {
    pairId,
    itemId: `mfab-${String(pairNumber).padStart(3, '0')}`,
    prompt: `Compute exactly: ${left} × ${right}.`,
    conceptIds: ['number-fractions'],
    difficulty: 'stress',
    answerFormat: 'integer',
    checker: { mode: 'exact_integer_string', expected },
    generation: { leftDigits, rightDigits, leftSha256: sha256(left), rightSha256: sha256(right) }
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function buildPairedExperiment({
  experimentId,
  seed,
  pairCount = 27,
  leftDigits = 13,
  rightDigits = 9,
  model = 'gpt-5.6-sol',
  thinking = 'low',
  generatedAt = new Date().toISOString()
} = {}) {
  if (!experimentId) throw new Error('experimentId is required');
  if (!Number.isInteger(pairCount) || pairCount < 1 || pairCount > 200) throw new Error('pairCount must be an integer from 1 to 200');
  const itemRng = new DeterministicRng(`${seed}:items:v1`);
  const scheduleRng = new DeterministicRng(`${seed}:schedule:v1`);
  const items = Array.from({ length: pairCount }, (_, index) => buildItem(index + 1, itemRng, { leftDigits, rightDigits }));
  const pairOrder = scheduleRng.shuffle(items.map((item) => item.pairId));
  const schedule = [];
  for (const pairId of pairOrder) {
    const armOrder = scheduleRng.int(2) === 0 ? ARMS : [...ARMS].reverse();
    for (const arm of armOrder) {
      schedule.push({
        ordinal: schedule.length + 1,
        pairId,
        arm,
        sessionId: `${experimentId}-${pairId}-${arm}-${sha256(`${seed}:${pairId}:${arm}:session:v1`).slice(0, 12)}`
      });
    }
  }
  return {
    schemaVersion: 'cortex.learning_os.paired_ab_experiment.v0',
    experimentId,
    generatedAt,
    status: 'preregistered',
    seed,
    seedSha256: sha256(seed),
    design: {
      type: 'randomized_paired_identical-item_fresh-session',
      arms: ARMS,
      pairCount,
      totalPlannedTrials: pairCount * 2,
      leftDigits,
      rightDigits,
      sameItemAcrossArms: true,
      freshSessionPerTrial: true,
      toolsAllowed: false,
      invalidTrialPolicy: 'No outcome-driven reruns. Any worker error, malformed response, missing answer, or observed tool event invalidates that trial and therefore its pair.',
      randomization: 'SHA-256 counter PRNG v1; generated pair order and within-pair arm order are fixed in this preregistration before model calls.'
    },
    runtime: { provider: 'openai-codex', model, thinking },
    intervention: {
      pack: 'A task-specific bounded retrieval pack is deterministically rebuilt from the canonical promoted math-foundations trusted lesson and supplied verbatim.',
      no_pack: 'No learning context supplied.'
    },
    analysisPlan: {
      primaryOutcome: 'deterministic exact-answer pass per trial',
      primaryEstimator: 'paired accuracy difference: pack minus no_pack over pairs with two valid trials',
      primaryTest: 'two-sided exact McNemar/binomial test over discordant valid pairs',
      minimumValidPairs: 24,
      maximumInvalidPairRate: 0.1,
      minimumAbsoluteLift: 0.1,
      alpha: 0.05,
      boundedCausalEvidenceGate: 'validPairs >= minimumValidPairs; invalidPairRate <= 0.10; pack accuracy lift >= 0.10; pack-only wins exceed no-pack-only wins; two-sided exact p <= 0.05',
      noDurabilityClaim: true
    },
    items,
    schedule,
    truthBoundary: 'This preregistered paired experiment can test a bounded retrieval-context effect for exact multiplication under the declared model and runtime. It cannot prove broad math learning, durability over time, model-weight learning, or general task improvement.'
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  const m = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= m; index += 1) result = result * (n - m + index) / index;
  return result;
}

export function exactMcNemarP(packOnly, noPackOnly) {
  const discordant = packOnly + noPackOnly;
  if (discordant === 0) return 1;
  const tail = Math.min(packOnly, noPackOnly);
  let cumulative = 0;
  for (let index = 0; index <= tail; index += 1) cumulative += choose(discordant, index) * (0.5 ** discordant);
  return Math.min(1, 2 * cumulative);
}

export function analyzePairedExperiment({ experiment, trials = [], generatedAt = new Date().toISOString() } = {}) {
  if (!experiment?.design?.pairCount) throw new Error('a preregistered experiment is required');
  const byPair = new Map(experiment.items.map((item) => [item.pairId, { item, pack: null, no_pack: null }]));
  for (const trial of trials) {
    const pair = byPair.get(trial.pairId);
    if (!pair || !ARMS.includes(trial.arm)) continue;
    if (pair[trial.arm]) throw new Error(`duplicate trial for ${trial.pairId}/${trial.arm}`);
    pair[trial.arm] = trial;
  }
  const pairResults = [];
  let bothPass = 0;
  let bothFail = 0;
  let packOnly = 0;
  let noPackOnly = 0;
  let invalidPairs = 0;
  for (const [pairId, pair] of byPair) {
    const pack = pair.pack;
    const noPack = pair.no_pack;
    const valid = Boolean(pack?.valid && noPack?.valid);
    let outcome = 'invalid';
    if (!valid) invalidPairs += 1;
    else if (pack.passed && noPack.passed) { bothPass += 1; outcome = 'both_pass'; }
    else if (!pack.passed && !noPack.passed) { bothFail += 1; outcome = 'both_fail'; }
    else if (pack.passed) { packOnly += 1; outcome = 'pack_only'; }
    else { noPackOnly += 1; outcome = 'no_pack_only'; }
    pairResults.push({ pairId, valid, outcome, packTrialId: pack?.trialId || null, noPackTrialId: noPack?.trialId || null });
  }
  const validPairs = experiment.design.pairCount - invalidPairs;
  const packPasses = bothPass + packOnly;
  const noPackPasses = bothPass + noPackOnly;
  const packAccuracy = validPairs ? packPasses / validPairs : 0;
  const noPackAccuracy = validPairs ? noPackPasses / validPairs : 0;
  const lift = packAccuracy - noPackAccuracy;
  const invalidPairRate = invalidPairs / experiment.design.pairCount;
  const pValue = exactMcNemarP(packOnly, noPackOnly);
  const plan = experiment.analysisPlan;
  const boundedCausalEvidence = validPairs >= plan.minimumValidPairs
    && invalidPairRate <= plan.maximumInvalidPairRate
    && lift >= plan.minimumAbsoluteLift
    && packOnly > noPackOnly
    && pValue <= plan.alpha;
  const result = {
    schemaVersion: 'cortex.learning_os.paired_ab_analysis.v0',
    experimentId: experiment.experimentId,
    generatedAt,
    plannedPairs: experiment.design.pairCount,
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
    boundedCausalEvidence,
    resultClass: boundedCausalEvidence ? 'bounded_retrieval_benefit_gate_passed' : 'gate_not_passed',
    allowedClaims: boundedCausalEvidence
      ? ['paired_randomized_experiment_completed', 'bounded_retrieval_benefit_for_exact_multiplication_under_declared_configuration']
      : ['paired_randomized_experiment_completed'],
    rejectedClaims: ['broad_math_improvement', 'durable_learning', 'general_domain_mastery', 'expert_mathematician', 'model_weight_learning'],
    pairResults,
    truthBoundary: boundedCausalEvidence
      ? 'The preregistered paired gate supports only a bounded retrieval-context benefit for the declared exact-multiplication distribution, model, and runtime; durability and broader transfer remain unproven.'
      : 'The experiment completed but did not meet the preregistered bounded causal-evidence gate; do not claim retrieval benefit, harm, broad improvement, durability, or model-weight learning.'
  };
  return result;
}
