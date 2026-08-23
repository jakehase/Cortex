import crypto from 'node:crypto';
import fs from 'node:fs';

const CATALOG_PATH = new URL('./phd-math-transfer-catalog.v1.json', import.meta.url);
const CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateTransferCatalog(catalog) {
  const errors = [];
  if (catalog?.schemaVersion !== 'cortex.learning_os.phd_math_transfer_catalog.v1'
      || catalog?.conceptCount !== 264
      || !Array.isArray(catalog?.concepts)
      || catalog.concepts.length !== 264
      || new Set(catalog.concepts.map((concept) => concept.conceptId)).size !== 264) {
    errors.push('catalog must contain exactly 264 unique concepts');
  }
  const derivation = catalog?.source?.derivation;
  const policy = derivation && {
    generatorId: derivation.generatorId,
    generatorVersion: derivation.generatorVersion,
    policyId: derivation.policyId,
    routingFields: derivation.routingFields,
    joinKey: derivation.joinKey,
    coreFields: derivation.coreFields,
    ordering: derivation.ordering,
  };
  const policyDigest = policy
    ? crypto.createHash('sha256').update(canonicalJson(policy)).digest('hex')
    : '';
  if (derivation?.generatorId !== 'cortex.learning_os.transfer_catalog_generator'
      || derivation?.generatorVersion !== '1.0.0'
      || derivation?.policyId !== 'rubric-concept-mapping-routing-v1'
      || canonicalJson(derivation?.routingFields) !== canonicalJson(['stage', 'tracks', 'requiredForQualification'])
      || derivation?.joinKey !== 'conceptId'
      || canonicalJson(derivation?.coreFields) !== canonicalJson(['conceptId', 'title', 'category', 'prerequisites', 'outcomes'])
      || derivation?.ordering !== 'source-curriculum-order'
      || derivation?.policySha256 !== policyDigest) {
    errors.push('catalog derivation policy provenance is missing or invalid');
  }
  const metadataSource = catalog?.source?.routingMetadataSource;
  if (metadataSource?.rubricId !== 'math-phd-competency-v1'
      || metadataSource?.rubricVersion !== '1.1.0'
      || !/^[0-9a-f]{64}$/.test(String(metadataSource?.sha256 || ''))) {
    errors.push('catalog routing metadata source provenance is missing or invalid');
  }
  return { ok: errors.length === 0, errors };
}

const catalogValidation = validateTransferCatalog(CATALOG);
if (!catalogValidation.ok) throw new Error(catalogValidation.errors.join('; '));

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'are', 'because', 'before', 'between', 'build', 'can', 'compute',
  'construction', 'derive', 'for', 'from', 'give', 'has', 'have', 'into', 'its', 'mathematical', 'method', 'methods',
  'one', 'only', 'over', 'problem', 'prove', 'show', 'software', 'some', 'such', 'system', 'that', 'the', 'their', 'theorem',
  'theory', 'then', 'this', 'through', 'under', 'use', 'using', 'verify', 'when', 'where', 'which', 'with', 'without',
]);

const ACRONYMS = new Set(['banach', 'bayes', 'borel', 'brownian', 'cauchy', 'clt', 'crt', 'fft', 'fubini', 'galois', 'gcd', 'glm', 'groebner', 'grobner', 'hessian', 'hilbert', 'ito', 'kkt', 'krylov', 'lp', 'markov', 'mcmc', 'mobius', 'ode', 'pde', 'qr', 'ramsey', 'riemann', 'sde', 'svd']);

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/[^a-z0-9+#._:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizedText(value)
    .replace(/[._:/-]+/g, ' ')
    .split(' ')
    .filter((token) => token && !STOP_WORDS.has(token) && (token.length >= 3 || ACRONYMS.has(token)));
}

function phrase(value) {
  return normalizedText(value).replace(/[._:/-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function softwareContext(text) {
  return /\b(?:api|code|coding|compiler|database|distributed system|implement|implementation|plugin|protocol|runtime|scheduler|software|typescript|javascript|python|rust|java|kotlin|swift|golang)\b/.test(text)
    || /\bc\+\+(?=$|\s|[.,;:!?()[\]{}])/.test(text)
    || /```|=>|\bfunction\s+[A-Za-z_$][\w$]*\s*\(|\bdef\s+[A-Za-z_]\w*\s*\(|\bfn\s+[A-Za-z_]\w*\s*\(/.test(text);
}

const LEGACY_MATCHERS = Object.freeze([
  {
    profileId: 'exact-multiplication',
    matcherId: 'code-exact-integer-multiplication-v1',
    conceptIds: ['number-fractions'],
    requiredAssumptionCodes: [
      'operands-are-integers',
      'exact-result-required',
      'arbitrary-precision-or-overflow-safety-required',
    ],
  },
  {
    profileId: 'algebra-factoring',
    matcherId: 'code-polynomial-factoring-v1',
    conceptIds: ['algebra-factoring'],
    requiredAssumptionCodes: [
      'univariate-polynomial',
      'integer-coefficients',
      'exact-symbolic-semantics',
    ],
  },
]);

function legacyMatcherEvaluation(profile, text, codingContext) {
  const observedAssumptionCodes = [];
  const negativeGateCodes = [];
  const applicabilityReasonCodes = [];
  if (!codingContext) negativeGateCodes.push('software-context-required');

  if (profile.profileId === 'exact-multiplication') {
    if (/\b(?:integer operands?|integers?|signed integers?)\b/.test(text)) observedAssumptionCodes.push('operands-are-integers');
    if (/\b(?:exact|exactly|exact product)\b/.test(text)) observedAssumptionCodes.push('exact-result-required');
    if (/\b(?:arbitrary[- ]precision|bigint|overflow[- ]safe|overflow safety)\b/.test(text)) {
      observedAssumptionCodes.push('arbitrary-precision-or-overflow-safety-required');
    }
    if (/\b(?:approximate|floating[- ]point|ieee[- ]?754|decimal fractions?|tolerance)\b/.test(text)) negativeGateCodes.push('non-integer-or-approximate-domain');
    if (/\b(?:authentication|cryptographic|crypto primitive)\b/.test(text)) negativeGateCodes.push('cryptographic-primitive');
    if (/\b(?:fixed[- ]width|saturating|simd|wraparound)\b/.test(text)) negativeGateCodes.push('fixed-width-semantics');
    applicabilityReasonCodes.push('legacy-exact-integer-multiplication-contract-v1');
  } else {
    if (/\bunivariate\b/.test(text) && /\bpolynomial\b/.test(text)) observedAssumptionCodes.push('univariate-polynomial');
    if (/\binteger (?:coefficients?|roots?)\b/.test(text)) observedAssumptionCodes.push('integer-coefficients');
    if (/\b(?:exact|symbolic|expand|expansion|evaluate|verify|zero)\b/.test(text)) observedAssumptionCodes.push('exact-symbolic-semantics');
    if (/\b(?:refactor|refactoring|factor out)\b/.test(text)) negativeGateCodes.push('software-refactor');
    if (/\b(?:multi[- ]factor authentication|authentication factor)\b/.test(text)) negativeGateCodes.push('authentication-factor');
    if (/\bfactorio\b/.test(text)) negativeGateCodes.push('factorio');
    if (/\b(?:business|risk|market|revenue) factors?\b/.test(text)) negativeGateCodes.push('non-polynomial-factor');
    if (/\b(?:approximate|floating[- ]point|newton|tolerance)\b/.test(text)) negativeGateCodes.push('approximate-numerical-roots');
    if (/\bpolynomial\b/.test(text) && !/\binteger (?:coefficients?|roots?)\b/.test(text)) negativeGateCodes.push('integer-coefficients-required');
    applicabilityReasonCodes.push('legacy-exact-polynomial-contract-v1');
  }

  const applicable = negativeGateCodes.length === 0
    && profile.requiredAssumptionCodes.every((code) => observedAssumptionCodes.includes(code));
  return {
    profileId: profile.profileId,
    conceptIds: [...profile.conceptIds],
    matcherId: profile.matcherId,
    applicabilityReasonCodes,
    observedAssumptionCodes,
    negativeGateCodes,
    applicable,
  };
}

const APPLICATION_RULES = Object.freeze([
  { id: 'exact-arithmetic', pattern: /\b(?:arbitrary precision|bigint|exact integer|integer overflow|rational arithmetic|decimal string multiplication)\b/, conceptIds: ['number-fractions', 'number-theory-modular-arithmetic', 'number-theory-chinese-remainder'] },
  { id: 'symbolic-polynomial', pattern: /\b(?:symbolic polynomial|polynomial factor|polynomial roots?|groebner|computational ideal)\b/, conceptIds: ['algebra-factoring', 'algebra-polynomial-arithmetic', 'commutative-algebra-grobner-bases'] },
  { id: 'numerical-stability', pattern: /\b(?:floating point|numerical stability|catastrophic cancellation|rounding error|underflow|condition number|stable summation|online variance|welford)\b/, conceptIds: ['numerical-analysis-floating-point-error', 'numerical-analysis-conditioning', 'statistics-variance'] },
  { id: 'matrix-solver', pattern: /\b(?:least squares|linear solver|linear system|matrix decomposition|pseudoinverse|\bsvd\b|\bqr\b|ill conditioned|krylov)\b/, conceptIds: ['linear-algebra-matrix-decompositions', 'numerical-analysis-direct-linear-solvers', 'numerical-analysis-krylov-iterations'] },
  { id: 'spectral-eigen', pattern: /\b(?:eigenvalue|eigenvector|spectral decomposition|principal component|\bpca\b)\b/, conceptIds: ['linear-algebra-eigenvalues', 'linear-algebra-spectral-theorem', 'functional-analysis-compact-spectral'] },
  { id: 'graphics-geometry', pattern: /\b(?:3d graphics|rendering geometry|mesh processing|surface normal|tangent space|geodesic|curvature tensor)\b/, conceptIds: ['linear-algebra-vectors', 'differential-geometry-smooth-manifolds-tangent', 'differential-geometry-geodesics-curvature'] },
  { id: 'network-flow', pattern: /\b(?:maximum flow|max flow|min cut|network flow|bipartite matching|capacitated assignment|augmenting path|residual graph)\b/, conceptIds: ['graph-theory-matchings-flows', 'combinatorics-matroids', 'optimization-linear-programming'] },
  { id: 'graph-routing', pattern: /\b(?:graph traversal|connectivity|shortest path|planarity|graph partition|graph coloring|dependency graph)\b/, conceptIds: ['discrete-graph-theory', 'graph-theory-connectivity-planarity', 'graph-theory-coloring-ramsey'] },
  { id: 'scheduling-allocation', pattern: /\b(?:job scheduling|resource allocation|constraint solver|allocation optimizer|assignment optimizer|packing problem)\b/, conceptIds: ['optimization-constraints', 'optimization-linear-programming', 'combinatorics-matroids'] },
  { id: 'convex-optimization', pattern: /\b(?:convex optimization|primal dual|duality gap|lagrange multiplier|karush kuhn tucker|\bkkt\b)\b/, conceptIds: ['optimization-convexity', 'optimization-duality-kkt', 'optimization-lagrange-multipliers'] },
  { id: 'gradient-optimization', pattern: /\b(?:gradient descent|stochastic gradient|optimizer convergence|hessian|second order optimizer)\b/, conceptIds: ['optimization-gradient-descent', 'optimization-hessian', 'optimization-stochastic-large-scale'] },
  { id: 'probabilistic-system', pattern: /\b(?:probabilistic system|failure probability|conditional probability|bayesian update|base rate|randomized algorithm)\b/, conceptIds: ['probability-conditional', 'probability-bayes', 'probability-independence'] },
  { id: 'markov-reliability', pattern: /\b(?:markov chain|transition matrix|stationary distribution|steady state probability|retry policy|failure transition)\b/, conceptIds: ['stochastic-processes-markov-chains', 'differential-equations-stability-lyapunov', 'probability-random-variables'] },
  { id: 'queue-waiting', pattern: /\b(?:queueing|queueing model|arrival rate|service rate|waiting time distribution|backoff distribution)\b/, conceptIds: ['probability-waiting-time', 'stochastic-processes-markov-chains', 'probability-expectation-linearity'] },
  { id: 'simulation-monte-carlo', pattern: /\b(?:monte carlo|stochastic simulation|importance sampling|variance reduction|random simulation)\b/, conceptIds: ['probability-expectation-linearity', 'statistics-variance', 'probability-convergence-laws-large-numbers'] },
  { id: 'experiment-statistics', pattern: /\b(?:a\/b test|experiment analysis|confidence interval|hypothesis test|statistical significance|sample size)\b/, conceptIds: ['statistics-confidence-intervals', 'statistics-hypothesis-tests', 'statistics-sampling-distributions'] },
  { id: 'regression-model', pattern: /\b(?:linear regression|generalized linear model|logistic regression|poisson regression|fisher scoring)\b/, conceptIds: ['statistics-linear-regression', 'statistics-linear-models', 'statistics-generalized-linear-models'] },
  { id: 'robust-nonparametric', pattern: /\b(?:robust estimator|outlier resistant|nonparametric|kernel density|rank test)\b/, conceptIds: ['statistics-median', 'statistics-nonparametric-methods', 'statistics-decision-sufficiency'] },
  { id: 'causal-inference', pattern: /\b(?:causal effect|causal inference|confounder|backdoor criterion|propensity score|instrumental variable|difference in differences|treatment effect)\b/, conceptIds: ['statistics-causation', 'statistics-causal-identification', 'measure-theory-radon-nikodym-conditional'] },
  { id: 'signal-fourier', pattern: /\b(?:signal processing|fourier transform|fourier series|frequency domain|spectral filter|convolution filter|\bfft\b)\b/, conceptIds: ['harmonic-analysis-fourier-transform', 'harmonic-analysis-convolution-approximation', 'harmonic-analysis-plancherel'] },
  { id: 'wavelet-localization', pattern: /\b(?:wavelet|time frequency|frequency localization|multiresolution)\b/, conceptIds: ['harmonic-analysis-wavelets-frequency-localization', 'harmonic-analysis-fourier-transform', 'functional-analysis-hilbert-riesz'] },
  { id: 'image-pde', pattern: /\b(?:image denoising|image segmentation|diffusion equation|heat equation|variational image)\b/, conceptIds: ['differential-equations-parabolic-semigroups', 'differential-equations-weak-solutions', 'numerical-analysis-finite-elements'] },
  { id: 'ode-simulation', pattern: /\b(?:ode solver|ordinary differential equation|time integration|runge kutta|dynamical simulation)\b/, conceptIds: ['differential-equations-ode-existence-uniqueness', 'numerical-analysis-quadrature-ode', 'differential-equations-stability-lyapunov'] },
  { id: 'pde-solver', pattern: /\b(?:pde solver|partial differential equation|finite element|finite difference|weak formulation)\b/, conceptIds: ['differential-equations-pde-classification', 'differential-equations-weak-solutions', 'numerical-analysis-finite-elements'] },
  { id: 'control-stability', pattern: /\b(?:control system|stability certificate|lyapunov function|bifurcation|state space model)\b/, conceptIds: ['differential-equations-stability-lyapunov', 'differential-equations-linear-systems', 'differential-equations-flows-bifurcations'] },
  { id: 'state-invariant', pattern: /\b(?:state machine invariant|protocol invariant|inductive invariant|safety property|model checking|counterexample trace|lease safety)\b/, conceptIds: ['proof-invariants-and-extremal-principles', 'proof-counterexample-construction', 'logic-first-order-syntax-semantics'] },
  { id: 'formal-specification', pattern: /\b(?:formal specification|proof obligation|precondition|postcondition|theorem prover|proof assistant|formal verification)\b/, conceptIds: ['research-practice-proof-architecture', 'proof-dependency-audit', 'logic-first-order-syntax-semantics'] },
  { id: 'termination-recursion', pattern: /\b(?:termination proof|recursive algorithm|structural recursion|loop variant|well founded)\b/, conceptIds: ['proof-strong-and-structural-induction', 'discrete-recurrences', 'set-theory-ordinals-transfinite'] },
  { id: 'concurrency-ordering', pattern: /\b(?:distributed consensus|partial order|happens before|event ordering|concurrent history|linearizability)\b/, conceptIds: ['discrete-sets-relations', 'combinatorics-posets-mobius', 'proof-invariants-and-extremal-principles'] },
  { id: 'database-logic', pattern: /\b(?:relational database|query optimizer|database constraint|relational algebra|logical query|datalog)\b/, conceptIds: ['discrete-sets-relations', 'logic-first-order-syntax-semantics', 'proof-equivalence-and-biconditionals'] },
  { id: 'type-category', pattern: /\b(?:type system|functor|natural transformation|category theory|compositional api|algebraic data type)\b/, conceptIds: ['abstract-algebra-category-functor-natural', 'functions-composition', 'proof-strong-and-structural-induction'] },
  { id: 'crypto-number-theory', pattern: /\b(?:cryptography|public key|rsa|modular inverse|finite field|elliptic curve cryptography|discrete log)\b/, conceptIds: ['number-theory-modular-arithmetic', 'abstract-algebra-field-extensions', 'number-theory-elliptic-curves'] },
  { id: 'crt-reconstruction', pattern: /\b(?:chinese remainder|modular reconstruction|coprime moduli|residue system|\bcrt\b)\b/, conceptIds: ['number-theory-chinese-remainder', 'number-theory-gcd', 'number-theory-modular-arithmetic'] },
  { id: 'error-correcting-algebra', pattern: /\b(?:error correcting code|coding theory|finite field code|reed solomon)\b/, conceptIds: ['abstract-algebra-field-extensions', 'linear-algebra-vector-spaces-subspaces', 'number-theory-modular-arithmetic'] },
  { id: 'topological-data', pattern: /\b(?:topological data analysis|persistent homology|simplicial complex|shape analysis)\b/, conceptIds: ['algebraic-topology-simplicial-cell-complexes', 'algebraic-topology-singular-homology', 'topology-spaces-bases'] },
  { id: 'spatial-topology', pattern: /\b(?:spatial topology|connected component|manifold mesh|topological connectivity|homotopy path)\b/, conceptIds: ['topology-connectedness-paths', 'topology-topological-manifolds', 'algebraic-topology-homotopy-fundamental-group'] },
  { id: 'asymptotic-analysis', pattern: /\b(?:asymptotic complexity|generating function|coefficient asymptotics|analytic combinatorics|recurrence asymptotics)\b/, conceptIds: ['combinatorics-analytic-asymptotics', 'combinatorics-bijections-generating-functions', 'discrete-recurrences'] },
  { id: 'random-graph', pattern: /\b(?:random graph|spectral graph|graph embedding|community detection)\b/, conceptIds: ['graph-theory-spectral-random-graphs', 'linear-algebra-spectral-theorem', 'combinatorics-probabilistic-method'] },
  { id: 'symbolic-dynamics', pattern: /\b(?:chaotic system|chaos detection|symbolic dynamics|sensitive dependence)\b/, conceptIds: ['differential-equations-chaos-symbolic-dynamics', 'differential-equations-flows-bifurcations', 'differential-equations-stability-lyapunov'] },
  { id: 'stochastic-calculus', pattern: /\b(?:brownian motion|ito calculus|stochastic differential equation|stochastic process|option pricing sde)\b/, conceptIds: ['stochastic-processes-brownian-ito', 'stochastic-processes-sde', 'stochastic-processes-martingales-stopping'] },
  { id: 'research-reproducibility', pattern: /\b(?:literature review|research corpus|reproducible computation|replication package|novelty check|peer review response)\b/, conceptIds: ['research-practice-literature-corpus', 'research-practice-computational-reproducibility', 'research-practice-novelty-adjudication'] },
]);

const CONCEPTS = CATALOG.concepts.map((concept) => ({
  ...concept,
  profileId: concept.conceptId,
  matcherId: `phd-math-${concept.conceptId}-v1`,
  titlePhrase: phrase(concept.title),
  idPhrase: phrase(concept.conceptId),
  termSet: new Set(tokens([concept.title, concept.conceptId, concept.category, ...concept.outcomes].join(' '))),
}));
const BY_ID = new Map(CONCEPTS.map((concept) => [concept.conceptId, concept]));
for (const rule of APPLICATION_RULES) {
  for (const conceptId of rule.conceptIds) if (!BY_ID.has(conceptId)) throw new Error(`unknown application-rule concept: ${conceptId}`);
}

const DOCUMENT_FREQUENCY = new Map();
for (const concept of CONCEPTS) {
  for (const token of concept.termSet) DOCUMENT_FREQUENCY.set(token, Number(DOCUMENT_FREQUENCY.get(token) || 0) + 1);
}

function lexicalScore(concept, text, queryTokens) {
  let score = 0;
  const reasons = [];
  if (text.includes(concept.conceptId)) {
    score += 1000;
    reasons.push('explicit-concept-id');
  }
  if (concept.titlePhrase.length >= 5 && text.includes(concept.titlePhrase)) {
    score += 700;
    reasons.push('exact-concept-title');
  }
  if (concept.idPhrase.length >= 5 && text.includes(concept.idPhrase)) {
    score += 500;
    reasons.push('concept-id-phrase');
  }
  const overlaps = [];
  for (const token of queryTokens) {
    if (!concept.termSet.has(token)) continue;
    const frequency = Number(DOCUMENT_FREQUENCY.get(token) || CATALOG.conceptCount);
    const weight = Math.max(4, Math.round(36 / Math.sqrt(frequency)));
    score += weight;
    overlaps.push({ token, weight, frequency });
  }
  const rare = overlaps.filter((item) => item.frequency <= 3 || ACRONYMS.has(item.token));
  if (overlaps.length >= 2) {
    score += 25;
    reasons.push('distinctive-term-overlap');
  } else if (rare.length === 1 && rare[0].token.length >= 6) {
    score += 25;
    reasons.push('rare-concept-term');
  }
  return { score, reasons, overlaps };
}

function applicationScores(text) {
  const scores = new Map();
  for (const rule of APPLICATION_RULES) {
    if (!rule.pattern.test(text)) continue;
    rule.conceptIds.forEach((conceptId, index) => {
      const row = scores.get(conceptId) || { score: 0, reasons: [], assumptions: [] };
      row.score += 420 - (index * 45);
      row.reasons.push(`application-${rule.id}`);
      row.assumptions.push(`application-model-${rule.id}`);
      scores.set(conceptId, row);
    });
  }
  return scores;
}

function mathCue(text) {
  return /\b(?:algebra|analysis|calculus|causal|combinatorics|congruence|equation|geometry|graph|logic|math|mathematics|matrix|measure|optimization|probability|proof|statistics|stochastic|topology)\b/.test(text)
    || /\b(?:banach|bayes|brownian|cauchy|clt|crt|fft|fubini|galois|gcd|glm|groebner|grobner|hilbert|ito|kkt|krylov|markov|mobius|ode|pde|ramsey|riemann|sde|svd)\b/.test(text);
}

export const TRANSFER_MATCHER_IDS = Object.freeze(CONCEPTS.map((concept) => concept.matcherId));
export const TRANSFER_PROFILE_IDS = Object.freeze(CONCEPTS.map((concept) => concept.profileId));
export const TRANSFER_CATALOG_METADATA = Object.freeze({
  catalogId: CATALOG.catalogId,
  conceptCount: CATALOG.conceptCount,
  source: { ...CATALOG.source },
});

export function routeMathTransfer(query, {
  allowedProfileIds = TRANSFER_PROFILE_IDS,
  selectionMode = 'shadow',
  maxSelections = 3,
} = {}) {
  const text = normalizedText(query);
  const codingContext = softwareContext(text);
  const allowed = new Set(Array.isArray(allowedProfileIds) ? allowedProfileIds : []);
  if (!text) {
    return {
      schemaVersion: 'cortex.learning_os.transfer_route.v2',
      codingContext,
      mathContext: false,
      selectionMode,
      answerInfluence: false,
      applicable: false,
      selections: [],
      evaluations: [],
      reasonCodes: ['empty-request'],
      catalogConceptCount: CATALOG.conceptCount,
    };
  }

  const queryTokens = new Set(tokens(text));
  const application = applicationScores(text);
  const candidates = [];
  for (const concept of CONCEPTS) {
    if (!allowed.has(concept.profileId)) continue;
    const lexical = lexicalScore(concept, text, queryTokens);
    const applied = application.get(concept.conceptId) || { score: 0, reasons: [], assumptions: [] };
    const score = lexical.score + applied.score;
    const hasStrongLexical = lexical.reasons.some((reason) => ['explicit-concept-id', 'exact-concept-title', 'concept-id-phrase', 'distinctive-term-overlap', 'rare-concept-term'].includes(reason));
    if (score < 70 || (!hasStrongLexical && applied.score === 0)) continue;
    const negativeGateCodes = codingContext ? [] : ['software-context-required'];
    candidates.push({
      profileId: concept.profileId,
      conceptIds: [concept.conceptId],
      matcherId: concept.matcherId,
      applicabilityReasonCodes: [...new Set([...applied.reasons, ...lexical.reasons])],
      observedAssumptionCodes: [...new Set([`stage-${concept.stage}`, ...applied.assumptions])],
      negativeGateCodes,
      applicable: negativeGateCodes.length === 0,
      score,
      ordinal: concept.ordinal,
    });
  }
  candidates.sort((left, right) => right.score - left.score || left.ordinal - right.ordinal);
  const boundedMaximum = Math.max(1, Math.min(3, Math.trunc(Number(maxSelections) || 3)));
  const evaluations = candidates.slice(0, boundedMaximum).map(({ ordinal, ...row }) => row);
  const selections = evaluations.filter((row) => row.applicable);
  const hasMathCue = mathCue(text) || application.size > 0 || selections.length > 0;
  return {
    schemaVersion: 'cortex.learning_os.transfer_route.v2',
    codingContext,
    mathContext: hasMathCue,
    selectionMode,
    answerInfluence: false,
    applicable: selections.length > 0,
    selections,
    evaluations,
    reasonCodes: selections.length
      ? ['full-spectrum-concept-selected']
      : evaluations.length && !codingContext
        ? ['software-context-required']
        : [hasMathCue ? 'no-grounded-concept-match' : 'math-context-not-observed'],
    catalogConceptCount: CATALOG.conceptCount,
  };
}

export function routeCodingTransfer(query, {
  allowedProfileIds = LEGACY_MATCHERS.map((profile) => profile.profileId),
  selectionMode = 'shadow',
} = {}) {
  const text = normalizedText(query);
  const codingContext = softwareContext(text);
  const allowed = new Set(Array.isArray(allowedProfileIds) ? allowedProfileIds : []);
  const evaluations = text
    ? LEGACY_MATCHERS.filter((profile) => allowed.has(profile.profileId))
      .map((profile) => legacyMatcherEvaluation(profile, text, codingContext))
    : [];
  const selections = evaluations.filter((row) => row.applicable);
  return {
    schemaVersion: 'cortex.learning_os.transfer_route.v1',
    codingContext,
    mathContext: evaluations.length > 0,
    selectionMode,
    answerInfluence: false,
    applicable: selections.length > 0,
    selections,
    evaluations,
    reasonCodes: selections.length
      ? ['legacy-coding-transfer-selected']
      : evaluations.some((row) => row.negativeGateCodes.length > 0)
        ? ['legacy-coding-transfer-gated']
        : ['legacy-coding-transfer-assumptions-not-observed'],
  };
}

export function routeTransferContracts(query, options = {}) {
  const legacy = routeCodingTransfer(query, options);
  const fullSpectrum = routeMathTransfer(query, options);
  return {
    schemaVersion: 'cortex.learning_os.transfer_route_bundle.v1',
    codingContext: legacy.codingContext || fullSpectrum.codingContext,
    mathContext: legacy.mathContext || fullSpectrum.mathContext,
    selectionMode: options.selectionMode || 'shadow',
    answerInfluence: false,
    applicable: legacy.applicable || fullSpectrum.applicable,
    selections: [...legacy.selections, ...fullSpectrum.selections],
    evaluations: [...legacy.evaluations, ...fullSpectrum.evaluations],
    reasonCodes: [...new Set([...legacy.reasonCodes, ...fullSpectrum.reasonCodes])],
    catalogConceptCount: fullSpectrum.catalogConceptCount,
  };
}

export function matcherDescriptor(matcherId) {
  const legacy = LEGACY_MATCHERS.find((row) => row.matcherId === matcherId);
  if (legacy) return { matcherId, profileId: legacy.profileId, conceptIds: [...legacy.conceptIds] };
  const concept = CONCEPTS.find((row) => row.matcherId === matcherId);
  return concept ? { matcherId, profileId: concept.profileId, conceptIds: [concept.conceptId] } : null;
}

export function conceptDescriptor(conceptId) {
  const concept = BY_ID.get(conceptId);
  if (!concept) return null;
  const { termSet, titlePhrase, idPhrase, profileId, matcherId, ...publicConcept } = concept;
  return { ...publicConcept, profileId, matcherId };
}
