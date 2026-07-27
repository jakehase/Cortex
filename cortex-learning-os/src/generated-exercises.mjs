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

function tolerant(prompt, expected, parameters, tolerance = 1e-9, answerFormat = 'number') {
  return { prompt, checker: { mode: 'numeric_tolerance', expected, tolerance }, parameters, answerFormat };
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
    return tolerant(
      `Compute the weighted mean of ${a} with weight ${weight} and ${b} with weight 1. Return an exact fraction or a decimal accurate to at least 9 places.`,
      (a * weight + b) / (weight + 1),
      { a, b, weight },
    );
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
  'algebra-polynomial-arithmetic': (v) => {
    const a = v.int(0, -8, 8); const b = v.int(1, -8, 8); const c = v.int(2, -8, 8);
    return exact(`What is the coefficient of x in (${a}x² ${b < 0 ? '-' : '+'} ${Math.abs(b)}x + 3) + (${c}x - 5)?`, b + c, { a, b, c });
  },
  'algebra-rational-expressions': (v) => {
    const a = v.int(0, 2, 9); let x = v.int(1, -8, 12);
    if (x === a) x += 1;
    return exact(`Evaluate exactly at x=${x}: (x²-${a ** 2})/(x-${a}).`, x + a, { a, x });
  },
  'algebra-complex-numbers': (v) => {
    const a = v.int(0, -7, 7); const b = v.int(1, -7, 7);
    return exact(`What is the real part of (${a}+i)(${b}-i)?`, a * b + 1, { a, b });
  },
  'functions-composition': (v) => {
    const a = v.int(0, 2, 7); const b = v.int(1, -8, 8); const c = v.int(2, -6, 6); const x = v.int(3, -5, 5);
    return exact(`Let f(t)=${a}t ${b < 0 ? '-' : '+'} ${Math.abs(b)} and g(t)=t ${c < 0 ? '-' : '+'} ${Math.abs(c)}. Compute (f∘g)(${x}).`, a * (x + c) + b, { a, b, c, x });
  },
  'functions-polynomial-behavior': (v) => {
    const even = v.int(0, 0, 1) === 0; const positive = v.int(1, 0, 1) === 0;
    const expected = even ? (positive ? 'A' : 'B') : (positive ? 'C' : 'D');
    return choice(
      `A polynomial has ${even ? 'even' : 'odd'} degree and a ${positive ? 'positive' : 'negative'} leading coefficient. Which end behavior is correct? A: both ends up; B: both ends down; C: left down/right up; D: left up/right down.`,
      expected,
      { even, positive },
    );
  },
  'precalculus-exponential-functions': (v) => {
    const base = v.int(0, 2, 5); const exponent = v.int(1, 2, 6);
    return integer(`Evaluate exactly: ${base}^${exponent}.`, base ** exponent, { base, exponent });
  },
  'precalculus-logarithms': (v) => {
    const base = v.int(0, 2, 6); const exponent = v.int(1, 2, 5);
    return exact(`Compute log base ${base} of ${base ** exponent}.`, exponent, { base, exponent });
  },
  'precalculus-unit-circle': (v) => {
    const row = v.pick(0, [
      ['0', 0],
      ['π/2', 1],
      ['π', 0],
      ['3π/2', -1],
    ]);
    return exact(`Compute sin(${row[0]}) exactly.`, row[1], { angle: row[0] });
  },
  'calculus-limits': (v) => {
    const a = v.int(0, 1, 6); const b = v.int(1, -8, 8); const c = v.int(2, -5, 5);
    return exact(`Compute lim x→${c} of (${a}x² ${b < 0 ? '-' : '+'} ${Math.abs(b)}x + 1).`, a * c ** 2 + b * c + 1, { a, b, c });
  },
  'calculus-continuity': (v) => {
    const c = v.int(0, -5, 5);
    return exact(`For x≠${c}, f(x)=(x²-${c ** 2})/(x${c < 0 ? '+' : '-'}${Math.abs(c)}). What value of f(${c}) makes f continuous?`, 2 * c, { c });
  },
  'calculus-product-rule': (v) => {
    const m = v.int(0, 1, 4); const n = v.int(1, 1, 4); const x = v.int(2, 1, 4);
    return exact(`If f(t)=t^${m}·t^${n}, compute f'(${x}) using the product rule.`, (m + n) * x ** (m + n - 1), { m, n, x });
  },
  'calculus-chain-rule': (v) => {
    const a = v.int(0, 2, 6); const b = v.int(1, -7, 7); const x = v.int(2, -4, 4);
    return exact(`For f(t)=(${a}t ${b < 0 ? '-' : '+'} ${Math.abs(b)})², compute f'(${x}).`, 2 * a * (a * x + b), { a, b, x });
  },
  'calculus-implicit-differentiation': (v) => {
    const x = v.pick(0, [3, 4, -3, -4]); const y = Math.abs(x) === 3 ? 4 : 3;
    return exact(`On x²+y²=25 at (${x},${y}), compute dy/dx.`, -x / y, { x, y });
  },
  'calculus-antiderivatives': (v) => {
    const n = v.int(0, 1, 6); const coefficient = v.int(1, 2, 8); const integrandCoefficient = coefficient * (n + 1);
    return exact(`Ignoring the integration constant, what is the coefficient of x^${n + 1} in ∫ ${integrandCoefficient}x^${n} dx?`, coefficient, { n, coefficient, integrandCoefficient });
  },
  'calculus-definite-integrals': (v) => {
    const upper = v.int(0, 2, 10);
    return exact(`Compute ∫ from 0 to ${upper} of 2x dx.`, upper ** 2, { upper });
  },
  'calculus-fundamental-theorem': (v) => {
    const a = v.int(0, 2, 7); const b = v.int(1, -8, 8); const x = v.int(2, -5, 5);
    return exact(`Let F(x)=∫ from 0 to x of (${a}t ${b < 0 ? '-' : '+'} ${Math.abs(b)}) dt. Compute F'(${x}).`, a * x + b, { a, b, x });
  },
  'calculus-substitution': (v) => {
    const upper = v.int(0, 1, 6);
    return exact(`Compute ∫ from 0 to ${upper} of 2x(x²+1) dx.`, ((upper ** 2 + 1) ** 2 - 1) / 2, { upper });
  },
  'calculus-series-convergence': (v) => {
    const ratio = v.pick(0, [-2, -0.5, 0.25, 1.5]);
    const expected = Math.abs(ratio) < 1 ? 'A' : 'B';
    return choice(`Does the infinite geometric series with common ratio ${ratio} converge? A: yes; B: no.`, expected, { ratio });
  },
  'linear-algebra-vectors': (v) => {
    const a = v.int(0, -7, 7); const b = v.int(1, -7, 7); const c = v.int(2, -7, 7); const d = v.int(3, -7, 7);
    return orderedTuple(`Compute (${a},${b})+(${c},${d}). Return the ordered pair.`, [a + c, b + d], { a, b, c, d });
  },
  'linear-algebra-dot-product': (v) => {
    const a = v.int(0, -6, 6); const b = v.int(1, -6, 6); const c = v.int(2, -6, 6); const d = v.int(3, -6, 6);
    return exact(`Compute the dot product (${a},${b})·(${c},${d}).`, a * c + b * d, { a, b, c, d });
  },
  'linear-algebra-matrix-multiplication': (v) => {
    const a = v.int(0, -5, 5); const b = v.int(1, -5, 5); const c = v.int(2, -5, 5); const d = v.int(3, -5, 5);
    const x = v.int(4, -4, 4); const y = v.int(5, -4, 4);
    return orderedTuple(`Compute [[${a},${b}],[${c},${d}]]·(${x},${y}).`, [a * x + b * y, c * x + d * y], { a, b, c, d, x, y });
  },
  'linear-algebra-linear-systems': (v) => {
    const x = v.int(0, -6, 6); const y = v.int(1, -6, 6);
    return orderedTuple(`Solve the system x+y=${x + y} and x-y=${x - y}. Return x,y.`, [x, y], { x, y });
  },
  'linear-algebra-row-reduction': (v) => {
    const k = v.int(0, 2, 6); const firstRhs = v.int(1, -5, 5); const target = v.int(2, -8, 8);
    const secondRhs = k * firstRhs + target;
    return exact(`Apply R2←R2-${k}R1 to an augmented matrix whose right-hand entries are ${firstRhs} and ${secondRhs}. What is the new R2 right-hand entry?`, target, { k, firstRhs, secondRhs });
  },
  'linear-algebra-independence': (v) => {
    const a = v.int(0, -6, 6); const b = v.int(1, 1, 7);
    return choice(`Are vectors (1,${a}) and (0,${b}) linearly independent? A: yes; B: no.`, 'A', { a, b });
  },
  'linear-algebra-eigenvalues': (v) => {
    const a = v.int(0, -8, 8); let b = v.int(1, -8, 8);
    if (b === a) b += 1;
    return setAnswer(`Give the eigenvalues of diagonal matrix [[${a},0],[0,${b}]].`, [a, b], { a, b });
  },
  'linear-algebra-orthogonal-projection': (v) => {
    const a = v.int(0, -9, 9); const b = v.int(1, -9, 9);
    return orderedTuple(`Project vector (${a},${b}) orthogonally onto the x-axis.`, [a, 0], { a, b });
  },
  'probability-random-variables': (v) => {
    const a = v.int(0, -6, 6); const d = v.int(1, 1, 8);
    return exact(`A random variable is equally likely to be ${a - d} or ${a + d}. What is E[X]?`, a, { a, d });
  },
  'probability-expectation-linearity': (v) => {
    const expectation = v.int(0, -5, 10); const a = v.int(1, 2, 7); const b = v.int(2, -8, 8);
    return exact(`Given E[X]=${expectation}, compute E[${a}X ${b < 0 ? '-' : '+'} ${Math.abs(b)}].`, a * expectation + b, { expectation, a, b });
  },
  'probability-discrete-distributions': (v) => {
    const n = v.int(0, 3, 12); const numerator = v.int(1, 1, 3); const denominator = 4;
    return exact(`If X~Binomial(${n}, ${numerator}/${denominator}), compute E[X].`, n * numerator / denominator, { n, numerator, denominator });
  },
  'statistics-covariance-correlation': (v) => {
    const variance = v.int(0, 1, 10); const a = v.int(1, -5, 5); const b = v.int(2, -8, 8);
    return exact(`Given Var(X)=${variance}, compute Cov(X, ${a}X ${b < 0 ? '-' : '+'} ${Math.abs(b)}).`, a * variance, { variance, a, b });
  },
  'statistics-sampling-distributions': (v) => {
    const rootN = v.int(0, 2, 6); const standardError = v.int(1, 1, 8); const sigma = rootN * standardError; const n = rootN ** 2;
    return exact(`A population standard deviation is ${sigma}. For samples of size ${n}, what is the standard error of the sample mean?`, standardError, { sigma, n });
  },
  'statistics-confidence-intervals': (v) => {
    const mean = v.int(0, -5, 30); const standardError = v.int(1, 1, 5); const margin = 2 * standardError;
    return orderedTuple(`Using estimate ± 2·SE, give the lower,upper interval for estimate ${mean} and SE ${standardError}.`, [mean - margin, mean + margin], { mean, standardError });
  },
  'statistics-hypothesis-tests': (v) => {
    const alpha = v.pick(0, [0.01, 0.05, 0.1]); const below = v.int(1, 0, 1) === 0;
    const p = below ? alpha / 2 : Math.min(0.9, alpha * 2);
    return choice(`A preregistered test has α=${alpha} and p=${p}. Which decision follows? A: reject the null; B: do not reject the null.`, below ? 'A' : 'B', { alpha, p });
  },
  'statistics-linear-regression': (v) => {
    const slope = v.int(0, -6, 6); const intercept = v.int(1, -8, 8); const x1 = v.int(2, -4, 1); const x2 = x1 + v.int(3, 1, 5);
    const y1 = slope * x1 + intercept; const y2 = slope * x2 + intercept;
    return exact(`What is the slope of the line through (${x1},${y1}) and (${x2},${y2})?`, slope, { slope, intercept, x1, x2 });
  },
  'discrete-logic': (v) => {
    const p = v.int(0, 0, 1) === 1; const q = v.int(1, 0, 1) === 1; const implication = !p || q;
    return choice(`Let P be ${p ? 'true' : 'false'} and Q be ${q ? 'true' : 'false'}. Is P→Q true? A: true; B: false.`, implication ? 'A' : 'B', { p, q });
  },
  'discrete-proof-induction': (v) => {
    const n = v.int(0, 5, 20);
    return integer(`The identity 1+2+...+n=n(n+1)/2 is proved by induction. Evaluate its right-hand side at n=${n}.`, n * (n + 1) / 2, { n });
  },
  'discrete-sets-relations': (v) => {
    const a = v.int(0, 8, 20); const b = v.int(1, 8, 20); const overlap = v.int(2, 1, Math.min(a, b) - 1);
    return exact(`If |A|=${a}, |B|=${b}, and |A∩B|=${overlap}, compute |A∪B|.`, a + b - overlap, { a, b, overlap });
  },
  'discrete-graph-theory': (v) => {
    const n = v.int(0, 4, 12);
    return integer(`How many edges does the complete simple graph K_${n} have?`, n * (n - 1) / 2, { n });
  },
  'discrete-recurrences': (v) => {
    const first = v.int(0, -5, 10); const step = v.int(1, 1, 8); const n = v.int(2, 4, 12);
    return exact(`A recurrence has a₁=${first} and aₙ=aₙ₋₁+${step}. Compute a_${n}.`, first + (n - 1) * step, { first, step, n });
  },
  'number-theory-modular-arithmetic': (v) => {
    const base = v.int(0, 2, 12); const exponent = v.int(1, 2, 6); const modulus = v.int(2, 3, 11);
    return exact(`Compute the least nonnegative residue of ${base}^${exponent} modulo ${modulus}.`, base ** exponent % modulus, { base, exponent, modulus });
  },
  'number-theory-gcd': (v) => {
    const gcd = v.int(0, 2, 12); const pair = v.pick(1, [[2, 3], [3, 4], [5, 6], [7, 8]]); const [a, b] = pair;
    return integer(`Compute gcd(${gcd * a}, ${gcd * b}).`, gcd, { gcd, a, b });
  },
  'number-theory-prime-factorization': (v) => {
    const primes = [2, 3, 5, 7, 11, 13];
    const firstIndex = v.int(0, 0, primes.length - 2); const secondIndex = v.int(1, firstIndex + 1, primes.length - 1);
    const first = primes[firstIndex]; const second = primes[secondIndex];
    return setAnswer(`Give the two prime factors of ${first * second}.`, [first, second], { first, second });
  },
  'optimization-convexity': (v) => {
    const positive = v.int(0, 0, 1) === 1; const a = v.int(1, 1, 8) * (positive ? 1 : -1);
    return choice(`Is f(x)=${a}x²+3x convex on the real line? A: yes; B: no.`, positive ? 'A' : 'B', { a });
  },
  'optimization-gradients': (v) => {
    const a = v.int(0, 1, 6); const b = v.int(1, 1, 6); const x = v.int(2, -5, 5); const y = v.int(3, -5, 5);
    return orderedTuple(`For f(x,y)=${a}x²+${b}y², compute ∇f at (${x},${y}).`, [2 * a * x, 2 * b * y], { a, b, x, y });
  },
  'optimization-hessian': (v) => {
    const a = v.int(0, 1, 7); const b = v.int(1, 1, 7);
    return exact(`For f(x,y)=${a}x²+${b}y², compute the determinant of its Hessian.`, 4 * a * b, { a, b });
  },
  'optimization-lagrange-multipliers': (v) => {
    const half = v.int(0, -6, 8); const total = 2 * half;
    return exact(`Minimize x²+y² subject to x+y=${total}. What is the minimizing x-coordinate?`, half, { total });
  },
  'optimization-linear-programming': (v) => {
    const a = v.int(0, 1, 8); let b = v.int(1, 1, 8);
    if (b === a) b += 1;
    const total = v.int(2, 3, 12);
    return exact(`For x,y≥0 and x+y≤${total}, what is the maximum of ${a}x+${b}y?`, Math.max(a, b) * total, { a, b, total });
  },
  'optimization-gradient-descent': (v) => {
    const x = 2 * v.int(0, -8, 8);
    return exact(`For f(x)=x², take one gradient-descent step from x=${x} with step size 1/4. What is the new x?`, x / 2, { x, stepSize: 0.25 });
  },
  'reasoning-truth-boundary': (v) => {
    const count = v.int(0, 1, 20);
    return choice(`A model passed ${count} fresh deterministic ${count === 1 ? 'exercise' : 'exercises'} in a declared run. Which claim is warranted? A: it has general mastery; B: its weights changed; C: it passed those recorded exercises; D: it will retain the skill indefinitely.`, 'C', { count });
  },
};

export const GENERATED_CONCEPT_IDS = Object.freeze(Object.keys(CATALOG).sort());

export function validateGeneratedExerciseCoverage(graph) {
  const conceptIds = Array.isArray(graph?.concepts)
    ? graph.concepts.map((concept) => concept?.conceptId)
    : [];
  const missing = conceptIds.filter((conceptId) => !Object.hasOwn(CATALOG, conceptId));
  return { ok: missing.length === 0, missing };
}

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
