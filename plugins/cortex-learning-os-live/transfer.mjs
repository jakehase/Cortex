const MATCHERS = Object.freeze({
  'code-exact-integer-multiplication-v1': {
    profileId: 'exact-multiplication',
    conceptIds: ['number-fractions'],
  },
  'code-polynomial-factoring-v1': {
    profileId: 'algebra-factoring',
    conceptIds: ['algebra-factoring'],
  },
});

export const TRANSFER_MATCHER_IDS = Object.freeze(Object.keys(MATCHERS));

function normalizedText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
}

function softwareContext(text) {
  return /\b(?:code|coding|software|program|programming|implement|implementation|algorithm|function|method|class|module|plugin|library|api|typescript|javascript|python|rust|java|kotlin|swift|c\+\+|c#|golang|bigint|input|output|return value|unit test|property test)\b/.test(text)
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
    const decision = matcherId === 'code-exact-integer-multiplication-v1'
      ? exactMultiplicationDecision(text)
      : factoringDecision(text);
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
