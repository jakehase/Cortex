function normalized(value, caseSensitive = false) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return caseSensitive ? text : text.toLowerCase();
}

function numeric(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? Number.NaN : Number(fraction[1]) / denominator;
  }
  return Number(text);
}

function asSet(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').replace(/^\[|\]$/g, '').split(',');
  return [...new Set(values.map((entry) => {
    const text = normalized(entry);
    const number = numeric(text);
    return text && Number.isFinite(number) ? String(Number(number.toPrecision(12))) : text;
  }).filter(Boolean))].sort();
}

function asOrderedNumericTuple(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? '').trim().replace(/^[([]|[)\]]$/g, '').split(',');
  if (values.length < 1) return null;
  const numbers = values.map((entry) => numeric(entry));
  return numbers.every(Number.isFinite) ? numbers : null;
}

export function checkAnswer(answer, checker = {}) {
  const mode = checker.mode;
  let passed = false;
  let observed = answer;
  if (mode === 'exact_number') {
    observed = numeric(answer);
    passed = Number.isFinite(observed) && observed === numeric(checker.expected);
  } else if (mode === 'exact_integer_string') {
    observed = String(answer ?? '').trim().replace(/[,_\s]/g, '').replace(/^\+/, '');
    const expected = String(checker.expected ?? '').trim().replace(/[,_\s]/g, '').replace(/^\+/, '');
    passed = /^-?\d+$/.test(observed) && observed === expected;
  } else if (mode === 'numeric_tolerance') {
    observed = numeric(answer);
    const expected = numeric(checker.expected);
    const tolerance = Math.max(0, Number(checker.tolerance ?? 1e-9));
    passed = Number.isFinite(observed) && Number.isFinite(expected) && Math.abs(observed - expected) <= tolerance;
  } else if (mode === 'exact_string' || mode === 'multiple_choice') {
    observed = normalized(answer, checker.caseSensitive === true);
    passed = observed === normalized(checker.expected, checker.caseSensitive === true);
  } else if (mode === 'set_equality') {
    observed = asSet(answer);
    const expected = asSet(checker.expected);
    passed = JSON.stringify(observed) === JSON.stringify(expected);
  } else if (mode === 'ordered_numeric_tuple') {
    observed = asOrderedNumericTuple(answer);
    const expected = asOrderedNumericTuple(checker.expected);
    passed = observed !== null && expected !== null
      && observed.length === expected.length
      && observed.every((value, index) => value === expected[index]);
  } else {
    return { passed: false, status: 'error', observed, reason: `unsupported checker mode: ${mode}` };
  }
  return {
    passed,
    status: passed ? 'passed' : 'failed',
    observed,
    reason: passed ? null : 'answer did not satisfy deterministic checker'
  };
}
