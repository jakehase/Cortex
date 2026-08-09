const MATCHERS = Object.freeze({
  'code-exact-integer-multiplication-v1': {
    profileId: 'exact-multiplication',
    conceptIds: ['number-fractions'],
    decisionId: 'exact-multiplication',
  },
  'code-polynomial-factoring-v1': {
    profileId: 'algebra-factoring',
    conceptIds: ['algebra-factoring'],
    decisionId: 'algebra-factoring',
  },
  'code-numerical-stability-v1': {
    profileId: 'numerical-stability',
    conceptIds: ['numerical-analysis-floating-point-error', 'numerical-analysis-conditioning'],
    decisionId: 'numerical-stability',
  },
  'code-network-flow-matching-v1': {
    profileId: 'network-flow-matching',
    conceptIds: ['graph-theory-matchings-flows', 'combinatorics-matroids'],
    decisionId: 'network-flow-matching',
  },
  'code-matrix-conditioning-v1': {
    profileId: 'matrix-conditioning',
    conceptIds: ['linear-algebra-matrix-decompositions', 'numerical-analysis-conditioning'],
    decisionId: 'matrix-conditioning',
  },
  'code-constrained-optimization-v1': {
    profileId: 'constrained-optimization',
    conceptIds: ['optimization-duality-kkt'],
    decisionId: 'constrained-optimization',
  },
  'code-stochastic-reliability-v1': {
    profileId: 'stochastic-reliability',
    conceptIds: ['stochastic-processes-markov-chains', 'differential-equations-stability-lyapunov'],
    decisionId: 'stochastic-reliability',
  },
  'code-state-invariants-v1': {
    profileId: 'state-invariants',
    conceptIds: ['proof-invariants-and-extremal-principles', 'proof-counterexample-construction'],
    decisionId: 'state-invariants',
  },
  'code-causal-analysis-v1': {
    profileId: 'causal-analysis',
    conceptIds: ['statistics-causal-identification'],
    decisionId: 'causal-analysis',
  },
  'code-modular-reconstruction-v1': {
    profileId: 'modular-reconstruction',
    conceptIds: ['number-theory-chinese-remainder'],
    decisionId: 'modular-reconstruction',
  },
});

export const TRANSFER_MATCHER_IDS = Object.freeze(Object.keys(MATCHERS));

function normalizedText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
}

function softwareContext(text) {
  return /\b(?:code|coding|software|program|programming|implement|implementation|algorithm|function|method|class|module|plugin|library|api|typescript|javascript|python|rust|java|kotlin|swift|c\+\+|c#|golang|bigint|input|output|return value|unit test|property test|system|service|scheduler|queue|database|distributed|protocol|worker|runtime)\b/.test(text)
    || /```|=>|function\s+\w+|def\s+\w+|fn\s+\w+/.test(text);
}

function exactMultiplicationDecision(text) {
  const reasons = [];
  const assumptions = [];
  const negatives = [];
  if (!/\b(?:integer|integers|whole number|signed number|decimal string|base-?10 digits?)\b/.test(text)) reasons.push('integer-domain-not-observed');
  else assumptions.push('operands-are-integers');
  if (!/\b(?:exact|exactly|lossless|without losing precision|no precision loss)\b/.test(text)) reasons.push('exact-result-not-observed');
  else assumptions.push('exact-result-required');
  if (!/\b(?:arbitrary precision|bigint|big integer|bignum|overflow[- ]safe|avoid overflow|beyond (?:number|max safe|64[- ]bit)|without (?:number|float))\b/.test(text)) reasons.push('overflow-safety-not-observed');
  else assumptions.push('arbitrary-precision-or-overflow-safety-required');
  if (!/\b(?:multiply|multiplication|product)\b/.test(text) && !/\w+\s*\*\s*\w+/.test(text)) reasons.push('multiplication-operation-not-observed');
  if (/\b(?:float|floating point|double|decimal fraction|approximate|approximately|tolerance|interval|probabilistic)\b/.test(text)) negatives.push('floating-point-domain');
  if (/\b(?:cryptograph|authentication|elliptic curve|finite field|modular multiplication|side channel|constant time)\b/.test(text)) negatives.push('cryptographic-primitive');
  if (/\b(?:wraparound|wrapping|saturating|simd|hardware register|fixed-width semantics)\b/.test(text)) negatives.push('hardware-fixed-width-semantics-required');
  const applicable = reasons.length === 0 && negatives.length === 0;
  return {
    applicable,
    reasonCodes: applicable ? ['software-exact-integer-product-observed'] : [...reasons, ...(negatives.length ? ['negative-gate-observed'] : [])],
    observedAssumptionCodes: assumptions,
    negativeGateCodes: negatives,
  };
}

function factoringDecision(text) {
  const reasons = [];
  const assumptions = [];
  const negatives = [];
  if (/\b(?:multi[- ]factor authentication|two[- ]factor|2fa|authentication factor|identity factor|auth factor)\b/.test(text)) negatives.push('authentication-factor');
  if (/\b(?:refactor|refactoring|code factor(?:ing)?|factor out (?:a )?(?:method|function|class|module))\b/.test(text)) negatives.push('software-refactor');
  if (/\bfactorio\b/.test(text)) negatives.push('factorio');
  if (/\b(?:business factor|risk factor|human factor|market factor|success factor|scaling factor|load factor|form factor|factor model)\b/.test(text)) negatives.push('business-factor');
  if (/\b(?:floating point|approximate roots?|numerical root|newton(?:'s)? method|tolerance)\b/.test(text)) negatives.push('approximate-numerical-roots');
  if (!/\b(?:polynomial|coefficient(?:s)?|quadratic|cubic)\b/.test(text)) reasons.push('polynomial-domain-not-observed');
  else assumptions.push('univariate-polynomial');
  if (!/\b(?:integer coefficients?|integer roots?|integral coefficients?|exact integer)\b/.test(text)) reasons.push('integer-coefficients-not-observed');
  else assumptions.push('integer-coefficients');
  if (!/\b(?:construct|expand|factor|factorization|integer roots?|evaluate|verify|zero)\b/.test(text)) reasons.push('polynomial-operation-not-observed');
  else assumptions.push('exact-symbolic-semantics');
  if (/\bfactor\b/.test(text) && reasons.includes('polynomial-domain-not-observed')) negatives.push('ambiguous-factor');
  const applicable = reasons.length === 0 && negatives.length === 0;
  return {
    applicable,
    reasonCodes: applicable ? ['software-integer-polynomial-operation-observed'] : [...reasons, ...(negatives.length ? ['negative-gate-observed'] : [])],
    observedAssumptionCodes: assumptions,
    negativeGateCodes: [...new Set(negatives)],
  };
}

function scopedDecision(text, descriptor) {
  const matched = descriptor.positive.test(text);
  const negatives = descriptor.negative ? descriptor.negative(text) : [];
  const applicable = matched && negatives.length === 0;
  return {
    applicable,
    reasonCodes: applicable
      ? [descriptor.reasonCode]
      : [matched ? 'negative-gate-observed' : `${descriptor.reasonCode}-not-observed`],
    observedAssumptionCodes: matched ? [...descriptor.assumptions] : [],
    negativeGateCodes: negatives,
  };
}

const SCOPED_DECISIONS = Object.freeze({
  'numerical-stability': {
    positive: /\b(?:floating[- ]point|numerical stability|catastrophic cancellation|rounding error|condition number|log[- ]sum[- ]exp|underflow|stable (?:variance|summation)|online variance|welford)\b/,
    reasonCode: 'software-numerical-stability-observed',
    assumptions: ['finite-precision-arithmetic', 'numerical-accuracy-matters'],
    negative: () => [],
  },
  'network-flow-matching': {
    positive: /\b(?:max(?:imum)? flow|min(?:imum)? cut|bipartite match(?:ing)?|capacitated assignment|residual graph|augmenting path)\b/,
    reasonCode: 'software-flow-or-matching-observed',
    assumptions: ['graph-capacities-or-matching-constraints'],
    negative: (text) => /\b(?:css flow|workflow|cash flow|traffic flow only)\b/.test(text) ? ['non-graph-flow'] : [],
  },
  'matrix-conditioning': {
    positive: /\b(?:least squares|linear system|matrix decomposition|\bqr\b|\bsvd\b|ill[- ]conditioned|condition number|pseudoinverse)\b/,
    reasonCode: 'software-matrix-conditioning-observed',
    assumptions: ['matrix-computation', 'stability-or-rank-matters'],
    negative: () => [],
  },
  'constrained-optimization': {
    positive: /\b(?:convex optimization|kkt|karush[- ]kuhn[- ]tucker|lagrange multiplier|primal[- ]dual|constrained (?:optimization|resource allocation)|duality gap)\b/,
    reasonCode: 'software-constrained-optimization-observed',
    assumptions: ['explicit-objective-and-constraints'],
    negative: (text) => /\b(?:seo optimization|compiler optimization only)\b/.test(text) ? ['non-mathematical-optimization'] : [],
  },
  'stochastic-reliability': {
    positive: /\b(?:markov chain|transition matrix|stationary distribution|steady[- ]state probability|queueing|stochastic process|retry (?:policy|budget)|failure transition)\b/,
    reasonCode: 'software-stochastic-reliability-observed',
    assumptions: ['state-transition-model'],
    negative: () => [],
  },
  'state-invariants': {
    positive: /\b(?:inductive invariant|state machine invariant|protocol invariant|safety property|model check(?:ing)?|counterexample trace|lease safety)\b/,
    reasonCode: 'software-state-invariant-observed',
    assumptions: ['explicit-state-and-transition-rules'],
    negative: () => [],
  },
  'causal-analysis': {
    positive: /\b(?:causal (?:effect|inference|identification)|confounder|backdoor criterion|propensity score|instrumental variable|difference[- ]in[- ]differences|treatment effect)\b/,
    reasonCode: 'software-causal-analysis-observed',
    assumptions: ['observational-or-experimental-data'],
    negative: () => [],
  },
  'modular-reconstruction': {
    positive: /\b(?:chinese remainder|\bcrt\b|modular congruence|coprime moduli|residue system)\b/,
    reasonCode: 'software-modular-reconstruction-observed',
    assumptions: ['integer-congruence-system'],
    negative: (text) => /\b(?:crt monitor|cathode ray)\b/.test(text) ? ['display-crt'] : [],
  },
});

function decide(decisionId, text) {
  if (decisionId === 'exact-multiplication') return exactMultiplicationDecision(text);
  if (decisionId === 'algebra-factoring') return factoringDecision(text);
  return scopedDecision(text, SCOPED_DECISIONS[decisionId]);
}

export function routeCodingTransfer(query, {
  allowedProfileIds = Object.values(MATCHERS).map((row) => row.profileId),
  selectionMode = 'shadow',
} = {}) {
  const text = normalizedText(query);
  const allowed = new Set(Array.isArray(allowedProfileIds) ? allowedProfileIds : []);
  const codeObserved = Boolean(text) && softwareContext(text);
  const decisions = [];
  if (!codeObserved) {
    return {
      schemaVersion: 'cortex.learning_os.transfer_route.v1',
      codingContext: false,
      selectionMode,
      answerInfluence: false,
      applicable: false,
      selections: [],
      evaluations: [],
      reasonCodes: [text ? 'software-context-not-observed' : 'empty-request'],
    };
  }
  for (const [matcherId, descriptor] of Object.entries(MATCHERS)) {
    if (!allowed.has(descriptor.profileId)) continue;
    const decision = decide(descriptor.decisionId, text);
    decisions.push({
      profileId: descriptor.profileId,
      conceptIds: [...descriptor.conceptIds],
      matcherId,
      applicabilityReasonCodes: decision.reasonCodes,
      observedAssumptionCodes: decision.observedAssumptionCodes,
      negativeGateCodes: decision.negativeGateCodes,
      applicable: decision.applicable,
    });
  }
  const selections = decisions.filter((row) => row.applicable);
  return {
    schemaVersion: 'cortex.learning_os.transfer_route.v1',
    codingContext: true,
    selectionMode,
    answerInfluence: false,
    applicable: selections.length > 0,
    selections,
    evaluations: decisions,
    reasonCodes: selections.length ? ['applicable-profile-selected'] : [...new Set(decisions.flatMap((row) => row.applicabilityReasonCodes))],
  };
}

export function matcherDescriptor(matcherId) {
  const value = MATCHERS[matcherId];
  return value ? { matcherId, profileId: value.profileId, conceptIds: [...value.conceptIds] } : null;
}
