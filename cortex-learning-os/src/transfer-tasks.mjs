import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { routeCodingTransfer } from '../../plugins/cortex-learning-os-live/transfer.mjs';
import { sha256Text } from './hash.mjs';

const FAMILY = new Set(['acquisition', 'held-out', 'negative-semantic', 'assumption-violation', 'regression']);

function seededInteger(seed, index, digits = 20) {
  const hex = sha256Text(`${seed}:${index}`);
  const raw = BigInt(`0x${hex.slice(0, 24)}`).toString();
  const body = raw.padStart(digits, '7').slice(0, digits).replace(/^0/, '7');
  return index % 2 ? `-${body}` : body;
}

function task(profileId, family, index, prompt, oracleId, input, expected) {
  const value = {
    schemaVersion: 'cortex.learning_os.transfer_task.v1',
    taskId: `${profileId}:${family}:${String(index).padStart(2, '0')}`,
    profileId,
    family,
    prompt,
    oracleId,
    input,
    expected,
    truthBoundary: 'Executable deterministic qualification task; not an empirical result or qualification claim.',
  };
  return { ...value, taskDigest: sha256Text(canonicalJson(value)) };
}

function semanticTasks(profileId) {
  if (profileId === 'exact-multiplication') {
    return [
      ['negative-semantic', 'Compute exactly: 6243088374 × 2167829.', false],
      ['negative-semantic', 'Implement constant-time modular multiplication for an authentication primitive.', false],
      ['negative-semantic', 'Write code that multiplies approximate floating-point measurements within a tolerance.', false],
      ['negative-semantic', 'Explain multiplication to a primary-school student.', false],
      ['negative-semantic', 'Implement saturating SIMD multiplication with fixed-width hardware semantics.', false],
      ['assumption-violation', 'Implement multiplication for decimal fractions using IEEE-754 doubles.', false],
      ['assumption-violation', 'Write a function that returns an approximate product.', false],
      ['assumption-violation', 'Implement integer multiplication; overflow behavior is unspecified.', false],
    ];
  }
  return [
    ['negative-semantic', 'Refactor this TypeScript authentication module.', false],
    ['negative-semantic', 'Implement multi-factor authentication for this API.', false],
    ['negative-semantic', 'Create a Factorio production-planning plugin.', false],
    ['negative-semantic', 'List the business factors affecting quarterly revenue.', false],
    ['negative-semantic', 'Factor out a helper method from this class.', false],
    ['negative-semantic', 'Implement a risk-factor model for a trading system.', false],
    ['assumption-violation', 'Implement approximate floating-point roots with Newton method and tolerance 1e-6.', false],
    ['assumption-violation', 'Write code to factor a polynomial over unspecified coefficient types.', false],
    ['assumption-violation', 'Find factors in this data set.', false],
  ];
}

function exactTasks(profileId, seed) {
  const rows = [];
  const families = [
    ...Array(2).fill('acquisition'),
    ...Array(4).fill('held-out'),
    ...Array(4).fill('regression'),
  ];
  for (let index = 0; index < families.length; index += 1) {
    const left = seededInteger(seed, index * 2, 18 + index);
    const right = seededInteger(seed, index * 2 + 1, 17 + index);
    const expected = (BigInt(left) * BigInt(right)).toString();
    rows.push(task(
      profileId,
      families[index],
      index + 1,
      `Implement an overflow-safe arbitrary-precision integer multiplication function. Return the exact signed decimal-string product for integer operands ${left} and ${right}; do not convert through floating point.`,
      'exact-integer-product-v1',
      { left, right },
      expected,
    ));
  }
  return rows;
}

function convolution(left, right) {
  const result = Array(left.length + right.length - 1).fill(0n);
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) result[i + j] += BigInt(left[i]) * BigInt(right[j]);
  }
  return result.map(String);
}

function factoringTasks(profileId, seed) {
  const rows = [];
  const families = [
    ...Array(2).fill('acquisition'),
    ...Array(4).fill('held-out'),
    ...Array(4).fill('regression'),
  ];
  for (let index = 0; index < families.length; index += 1) {
    const leftRoot = Number(BigInt(`0x${sha256Text(`${seed}:factor:${index}`).slice(0, 4)}`) % 19n) - 9;
    const rightRoot = Number(BigInt(`0x${sha256Text(`${seed}:factor-b:${index}`).slice(0, 4)}`) % 23n) - 11;
    const factors = [[String(-leftRoot), '1'], [String(-rightRoot), '1']];
    const coefficients = convolution(factors[0], factors[1]);
    rows.push(task(
      profileId,
      families[index],
      index + 1,
      `Implement exact code for a univariate polynomial with integer coefficients in ascending order. Construct and expand factors for integer roots ${leftRoot} and ${rightRoot}, return JSON {"factors":[[constant,linear],[constant,linear]],"roots":[...]}, and verify each claimed root evaluates to exact zero. Input coefficients: [${coefficients.join(',')}].`,
      'integer-polynomial-identity-v1',
      { coefficients },
      JSON.stringify({ factors, roots: [String(leftRoot), String(rightRoot)] }),
    ));
  }
  return rows;
}

export function generateTransferTasks(profile, { seed } = {}) {
  if (!profile?.profileId || typeof seed !== 'string' || seed.length < 1 || seed.length > 256) throw new Error('profile and bounded seed are required');
  const positive = profile.profileId === 'exact-multiplication'
    ? exactTasks(profile.profileId, seed)
    : factoringTasks(profile.profileId, seed);
  const semantic = semanticTasks(profile.profileId).map(([family, prompt, expected], index) => task(
    profile.profileId,
    family,
    index + 1,
    prompt,
    family === 'regression' ? 'regression-route-v1' : 'semantic-route-v1',
    {},
    String(expected),
  ));
  const tasks = [...positive, ...semantic].sort((left, right) => left.taskId.localeCompare(right.taskId));
  if (tasks.length > 40 || tasks.some((row) => !FAMILY.has(row.family))) throw new Error('generated transfer task budget exceeded');
  return tasks;
}

function normalizePolynomial(value) {
  const result = value.map((item) => BigInt(item));
  while (result.length > 1 && result.at(-1) === 0n) result.pop();
  return result;
}

function evaluatePolynomial(coefficients, x) {
  let result = 0n;
  for (let index = coefficients.length - 1; index >= 0; index -= 1) result = result * x + coefficients[index];
  return result;
}

export function replayTransferOracle(taskValue, resultText) {
  let passed = false;
  let resultCode = 'oracle-failed';
  try {
    if (taskValue.oracleId === 'exact-integer-product-v1') {
      const expected = (BigInt(taskValue.input.left) * BigInt(taskValue.input.right)).toString();
      passed = String(resultText).trim() === expected;
      resultCode = passed ? 'exact-product-match' : 'exact-product-mismatch';
    } else if (taskValue.oracleId === 'integer-polynomial-identity-v1') {
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
          || Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, 'factors') || !Object.hasOwn(parsed, 'roots')
          || !Array.isArray(parsed.factors) || parsed.factors.length !== 2
          || parsed.factors.some((factor) => !Array.isArray(factor) || factor.length !== 2)
          || !Array.isArray(parsed.roots) || parsed.roots.length !== 2) throw new Error('invalid bounded polynomial result shape');
      const factors = parsed.factors.map((factor) => normalizePolynomial(factor));
      if (factors.some((factor) => factor.length !== 2 || factor[1] !== 1n)) throw new Error('factors must be monic linear integer factors');
      const expanded = factors.reduce((left, right) => normalizePolynomial(convolution(left, right)));
      const expected = normalizePolynomial(taskValue.input.coefficients);
      const roots = parsed.roots.map((root) => BigInt(root));
      const factorRoots = factors.map((factor) => -factor[0]);
      passed = canonicalJson(expanded.map(String)) === canonicalJson(expected.map(String))
        && canonicalJson(roots.map(String).sort()) === canonicalJson(factorRoots.map(String).sort())
        && roots.every((root) => evaluatePolynomial(expected, root) === 0n);
      resultCode = passed ? 'polynomial-identity-and-roots-match' : 'polynomial-or-root-mismatch';
    } else {
      const route = routeCodingTransfer(taskValue.prompt, { allowedProfileIds: [taskValue.profileId] });
      passed = String(route.applicable) === String(taskValue.expected);
      resultCode = passed ? 'semantic-decision-match' : 'semantic-decision-mismatch';
    }
  } catch {
    passed = false;
    resultCode = 'oracle-input-invalid';
  }
  return {
    oracleId: taskValue.oracleId,
    executed: true,
    passed,
    resultDigest: sha256Text(canonicalJson({ taskDigest: taskValue.taskDigest, resultCode, passed })),
  };
}

export function transferTaskSetDigest(tasks) {
  return sha256Text(canonicalJson(tasks));
}
