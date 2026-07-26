import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { checkAnswer } from './checkers.mjs';
import { sha256Text } from './hash.mjs';

export const EXERCISE_ROLES = Object.freeze([
  'baseline', 'acquisition', 'correction', 'promotion-transfer', 'held-out', 'spaced-review',
]);

function choose(n, k) {
  const count = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= count; index += 1) result = result * (n - count + index) / index;
  return result;
}

function hashInt(text, offset, maximum) {
  const digest = crypto.createHash('sha256').update(`${text}:${offset}`).digest();
  return digest.readUInt32BE(0) % maximum;
}

function values(key) {
  return {
    int(offset, minimum, maximum) {
      return minimum + hashInt(key, offset, maximum - minimum + 1);
    },
    pick(offset, choices) {
      return choices[hashInt(key, offset, choices.length)];
    },
  };
}

function exact(prompt, expected, parameters, answerFormat = 'number') {
  return { prompt, checker: { mode: 'exact_number', expected }, parameters, answerFormat };
}

function integer(prompt, expected, parameters) {
  return { prompt, checker: { mode: 'exact_integer_string', expected: String(expected) }, parameters, answerFormat: 'integer' };
}

function setAnswer(prompt, expected, parameters) {
  return { prompt, checker: { mode: 'set_equality', expected }, parameters, answerFormat: 'comma-separated set' };
}

function orderedTuple(prompt, expected, parameters) {
  return { prompt, checker: { mode: 'ordered_numeric_tuple', expected }, parameters, answerFormat: 'ordered pair x,y' };
}

function choice(prompt, expected, parameters) {
  return { prompt, checker: { mode: 'multiple_choice', expected }, parameters, answerFormat: 'one letter' };
}

const CATALOG = {
  'number-fractions': (v) => {
    const b = v.int(0, 3, 12); const a = v.int(1, 1, b - 1); const c = v.int(2, 1, b - 1);
    return exact(`Compute exactly: ${a}/${b} + ${c}/${b}.`, (a + c) / b, { a, b, c });
  },
  'algebra-inverse-operations': (v) => {
    const x = v.int(0, -12, 12); const a = v.int(1, 2, 15); const total = x + a;
    return exact(`Solve for x: x + ${a} = ${total}.`, x, { a, total });
  },
  'algebra-linear-equations': (v) => {
    const x = v.int(0, -9, 11); const a = v.int(1, 2, 9); const b = v.int(2, -12, 12); const c = a * x + b;
    return exact(`Solve for x: ${a}x ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${c}.`, x, { a, b, c });
  },
  'algebra-factoring': (v) => {
    const r1 = v.int(0, -8, -1); const r2 = v.int(1, 1, 9); const b = -(r1 + r2); const c = r1 * r2;
    return setAnswer(`Give the two zeros of x² ${b < 0 ? '-' : '+'} ${Math.abs(b)}x ${c < 0 ? '-' : '+'} ${Math.abs(c)}.`, [r1, r2], { b, c });
  },
  'algebra-quadratics': (v) => {
    const r1 = v.int(0, 1, 7); const r2 = v.int(1, r1 + 1, 11); const b = -(r1 + r2); const c = r1 * r2;
    return setAnswer(`Solve x² ${b < 0 ? '-' : '+'} ${Math.abs(b)}x + ${c} = 0. Return both roots.`, [r1, r2], { b, c });
  },
  'algebra-absolute-value': (v) => {
    const center = v.int(0, -8, 8); const radius = v.int(1, 2, 10);
    return setAnswer(`Solve |x ${center < 0 ? '+' : '-'} ${Math.abs(center)}| = ${radius}.`, [center - radius, center + radius], { center, radius });
  },
  'functions-evaluation': (v) => {
    const a = v.int(0, 2, 7); const b = v.int(1, -9, 9); const x = v.int(2, -6, 6);
    return exact(`If f(t) = ${a}t ${b < 0 ? '-' : '+'} ${Math.abs(b)}, compute f(${x}).`, a * x + b, { a, b, x });
  },
  'functions-inverse': (v) => {
    const a = v.int(0, 2, 8); const x = v.int(1, -7, 9); const b = v.int(2, -10, 10); const y = a * x + b;
    return exact(`For f(x) = ${a}x ${b < 0 ? '-' : '+'} ${Math.abs(b)}, compute f⁻¹(${y}).`, x, { a, b, y });
  },
  'functions-transformations': (v) => {
    const h = v.int(0, 2, 9);
    return choice(`Relative to y=f(x), what does y=f(x-${h}) do? A: shift left ${h}; B: shift right ${h}; C: scale vertically by ${h}; D: reflect.`, 'B', { h });
  },
  'series-geometric': (v) => {
    const first = v.int(0, 1, 6); const terms = v.int(1, 3, 7); const expected = first * (2 ** terms - 1);
    return exact(`Compute the ${terms}-term geometric sum ${first} + ${first * 2} + ... with common ratio 2.`, expected, { first, terms });
  },
  'probability-counting': (v) => {
    const shirts = v.int(0, 3, 9); const pants = v.int(1, 2, 8);
    return exact(`A choice uses one of ${shirts} shirts and one of ${pants} pairs of pants. How many outfits are possible?`, shirts * pants, { shirts, pants });
  },
  'probability-binomial': (v) => {
    const n = v.int(0, 4, 7); const k = v.int(1, 1, n - 1);
    return exact(`A fair coin is tossed ${n} times. What is the probability of exactly ${k} heads?`, choose(n, k) / 2 ** n, { n, k });
  },
  'probability-complements': (v) => {
    const n = v.int(0, 2, 7);
    return exact(`A fair coin is tossed ${n} times. What is the probability of at least one head?`, 1 - 1 / 2 ** n, { n });
  },
  'probability-conditional': (v) => {
    const red = v.int(0, 2, 8); const blue = v.int(1, 2, 8);
    return exact(`A bag has ${red} red and ${blue} blue balls. Given that a drawn ball is red or blue, what is P(red)?`, red / (red + blue), { red, blue });
  },
  'probability-bayes': (v) => {
    const truePositive = v.int(0, 6, 12); const falsePositive = v.int(1, 2, 6);
    return exact(`Among positive tests, ${truePositive} are true positives and ${falsePositive} are false positives. What is P(condition | positive)?`, truePositive / (truePositive + falsePositive), { truePositive, falsePositive });
  },
  'probability-independence': (v) => {
    const p = v.int(0, 2, 8) / 10; const q = v.int(1, 2, 8) / 10;
    return choice(`Events A and B are declared independent with P(A)=${p} and P(B)=${q}. Which is P(A∩B)? A: ${p + q}; B: ${p * q}; C: ${Math.abs(p - q)}; D: cannot be determined.`, 'B', { p, q });
  },
  'probability-inclusion-exclusion': (v) => {
    const a = v.int(0, 20, 40); const b = v.int(1, 20, 40); const overlap = v.int(2, 5, Math.min(a, b) - 2);
    return exact(`In 100 cases, ${a} have A, ${b} have B, and ${overlap} have both. How many have A or B?`, a + b - overlap, { a, b, overlap });
  },
  'probability-waiting-time': (v) => {
    const length = v.pick(0, [2, 3]); const expected = length === 2 ? 6 : 14;
    return exact(`For fair independent coin tosses, what is the expected number of tosses until ${'H'.repeat(length)} first appears?`, expected, { length });
  },
  'probability-combinatorics': (v) => {
    const n = v.int(0, 6, 11); const k = v.int(1, 2, Math.min(5, n - 1));
    return exact(`How many unordered groups of ${k} can be chosen from ${n} distinct people?`, choose(n, k), { n, k });
  },
  'statistics-mean': (v) => {
    const center = v.int(0, -5, 15); const d = v.int(1, 1, 8);
    return exact(`Find the mean of ${center - d}, ${center}, and ${center + d}.`, center, { center, d });
  },
  'statistics-weighted-mean': (v) => {
    const a = v.int(0, 2, 12); const b = v.int(1, 2, 12); const weight = v.int(2, 1, 4);
    return exact(`Compute the weighted mean of ${a} with weight ${weight} and ${b} with weight 1.`, (a * weight + b) / (weight + 1), { a, b, weight });
  },
  'statistics-median': (v) => {
    const middle = v.int(0, -4, 14); const d1 = v.int(1, 1, 5); const d2 = v.int(2, 1, 5);
    return exact(`Find the median of ${middle + d2}, ${middle - d1}, ${middle}.`, middle, { middle, d1, d2 });
  },
  'statistics-variance': (v) => {
    const center = v.int(0, -5, 10); const d = v.int(1, 1, 7);
    return exact(`Using population variance, find the variance of ${center - d} and ${center + d}.`, d ** 2, { center, d });
  },
  'statistics-bernoulli': (v) => {
    const numerator = v.int(0, 1, 4); const denominator = v.int(1, numerator + 1, 6);
    const varianceNumerator = numerator * (denominator - numerator); const varianceDenominator = denominator ** 2;
    return exact(`A Bernoulli variable has p=${numerator}/${denominator}. What is its variance?`, `${varianceNumerator}/${varianceDenominator}`, { numerator, denominator });
  },
  'statistics-z-score': (v) => {
    const mean = v.int(0, 10, 30); const sd = v.int(1, 2, 6); const z = v.int(2, -3, 3); const x = mean + z * sd;
    return exact(`An observation is ${x}, the mean is ${mean}, and the standard deviation is ${sd}. What is its z-score?`, z, { mean, sd, x });
  },
  'statistics-causation': (v) => {
    const scenario = v.pick(0, [
      ['umbrella use', 'wet streets', 'rain'],
      ['ice-cream sales', 'sunburn cases', 'hot weather'],
      ['heater use', 'winter coats', 'cold weather'],
    ]);
    return choice(`An observational study associates ${scenario[0]} with ${scenario[1]}. Which conclusion is justified? A: the first causes the second; B: ${scenario[2]} may cause both; C: the second causes the first; D: association proves causation.`, 'B', { scenario });
  },
  'calculus-derivative': (v) => {
    const a = v.int(0, 2, 8); const b = v.int(1, -8, 8); const x = v.int(2, -5, 5);
    return exact(`For f(x)=${a}x² ${b < 0 ? '-' : '+'} ${Math.abs(b)}x, compute f'(${x}).`, 2 * a * x + b, { a, b, x });
  },
  'optimization-quadratic': (v) => {
    const h = v.int(0, -8, 8); const k = v.int(1, 1, 20);
    return exact(`At what x is q(x)=-(x${h < 0 ? '+' : '-'}${Math.abs(h)})²+${k} maximized?`, h, { h, k });
  },
  'optimization-multivariate': (v) => {
    const a = v.int(0, -6, 6); const b = v.int(1, -6, 6);
    return orderedTuple(`For f(x,y)=(x${a < 0 ? '+' : '-'}${Math.abs(a)})²+(y${b < 0 ? '+' : '-'}${Math.abs(b)})², return the minimizing ordered pair x,y.`, [a, b], { a, b });
  },
  'optimization-constraints': (v) => {
    const total = v.int(0, 6, 16) * 2;
    return exact(`For nonnegative x,y with x+y=${total}, what value of x maximizes xy?`, total / 2, { total });
  },
  'reasoning-percent-base': (v) => {
    const original = v.int(0, 20, 80); const increase = v.int(1, 2, 20);
    return exact(`A value rises from ${original} to ${original + increase}. What is the fractional increase relative to the original value?`, increase / original, { original, increase });
  },
  'reasoning-expected-value': (v) => {
    const win = v.int(0, 5, 20); const lose = v.int(1, 1, 8); const numerator = v.int(2, 1, 3); const denominator = 4;
    return exact(`A payoff is ${win} with probability ${numerator}/${denominator}, otherwise -${lose}. What is its expected value?`, win * numerator / denominator - lose * (denominator - numerator) / denominator, { win, lose, numerator, denominator });
  },
  'reasoning-sample-space': (v) => {
    const red = v.int(0, 2, 7); const blue = v.int(1, 2, 7);
    return exact(`A bag has ${red} red, ${blue} blue, and 5 green balls. Given the ball is not green, what is P(red)?`, red / (red + blue), { red, blue });
  },
  'reasoning-self-overlap': (v) => {
    const pattern = v.pick(0, ['HHH', 'HTH', 'THT', 'TTT', 'HHT', 'HTT', 'THH', 'TTH']);
    const expected = pattern[0] === pattern.at(-1) ? 'A' : 'B';
    return choice(`Does pattern ${pattern} have a nonempty proper prefix equal to a suffix? A: yes; B: no.`, expected, { pattern });
  },
  'linear-algebra-determinant': (v) => {
    const a = v.int(0, 2, 8); const b = v.int(1, 2, 8); const c = v.int(2, 2, 8);
    return exact(`Compute det([[${a},1,2],[0,${b},3],[0,0,${c}]]).`, a * b * c, { a, b, c });
  },
  'reasoning-truth-boundary': (v) => {
    const count = v.int(0, 1, 20);
    return choice(`A model passed ${count} fresh deterministic ${count === 1 ? 'exercise' : 'exercises'} in a declared run. Which claim is warranted? A: it has general mastery; B: its weights changed; C: it passed those recorded exercises; D: it will retain the skill indefinitely.`, 'C', { count });
  },
};

export const GENERATED_CONCEPT_IDS = Object.freeze(Object.keys(CATALOG).sort());

export function generateExercise({ conceptId, seed, role } = {}) {
  if (!Object.hasOwn(CATALOG, conceptId)) throw new Error(`unsupported generated-exercise conceptId: ${String(conceptId)}`);
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 256) throw new Error('exercise seed must be a non-empty string of at most 256 characters');
  if (!EXERCISE_ROLES.includes(role)) throw new Error(`unsupported exercise role: ${String(role)}`);
  const key = `${conceptId}:${role}:${seed}:generated-exercise-v1`;
  const built = CATALOG[conceptId](values(key));
  built.parameters = { ...built.parameters, variant: sha256Text(key).slice(0, 16) };
  const family = `${conceptId}-seeded-v1`;
  const oracleDigest = sha256Text(canonicalJson({ family, parameters: built.parameters, checker: built.checker }));
  return {
    schemaVersion: 'cortex.learning_os.exam_item.v0',
    itemId: `adaptive-${sha256Text(key).slice(0, 20)}`,
    prompt: built.prompt,
    conceptIds: [conceptId],
    difficulty: role,
    answerFormat: built.answerFormat,
    checker: built.checker,
    generation: {
      schemaVersion: 'cortex.learning_os.exercise_generation.v1',
      generatorVersion: '1.0.0',
      family,
      conceptId,
      seed,
      role,
      parameters: built.parameters,
      oracleDigest,
    },
  };
}

export function replayGeneratedExercise(item) {
  const metadata = item?.generation;
  if (!metadata || metadata.schemaVersion !== 'cortex.learning_os.exercise_generation.v1') throw new Error('missing generated-exercise metadata');
  const regenerated = generateExercise({ conceptId: metadata.conceptId, seed: metadata.seed, role: metadata.role });
  if (canonicalJson(regenerated) !== canonicalJson(item)) throw new Error(`generated exercise replay mismatch: ${String(item?.itemId || 'unknown')}`);
  return regenerated;
}

export function verifyGeneratedAnswer({ item, answer } = {}) {
  replayGeneratedExercise(item);
  return checkAnswer(answer, item.checker);
}
