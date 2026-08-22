#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  TRANSFER_ENTRY_SCHEMA,
  TRANSFER_REGISTRY_SCHEMA,
  atomicWriteSignedTransferRegistry,
  initializeTransferRegistry,
  readTransferRegistrySecret,
} from '../../plugins/cortex-learning-os-live/transfer-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'cortex-learning-os-live');
const CATALOG_PATH = path.join(PLUGIN_ROOT, 'phd-math-transfer-catalog.v1.json');
const CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

if (CATALOG?.schemaVersion !== 'cortex.learning_os.phd_math_transfer_catalog.v1'
    || CATALOG?.conceptCount !== 264
    || !Array.isArray(CATALOG?.concepts)
    || CATALOG.concepts.length !== 264
    || new Set(CATALOG.concepts.map((concept) => concept.conceptId)).size !== 264) {
  throw new Error('operator install requires the exact 264-concept full-spectrum catalog');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

function loadSignedRegistryEnvelopeForMigration(registryPath, secret) {
  const stat = fs.lstatSync(registryPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('transfer registry migration source must be an owner-only regular file');
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (registry?.schemaVersion !== TRANSFER_REGISTRY_SCHEMA
      || !Number.isSafeInteger(registry?.revision) || registry.revision < 0
      || !Array.isArray(registry?.entries) || registry.entries.length > 320
      || registry?.signature?.algorithm !== 'hmac-sha256'
      || typeof registry?.signature?.keyId !== 'string'
      || typeof registry?.signature?.digest !== 'string' || !/^[0-9a-f]{64}$/.test(registry.signature.digest)) {
    throw new Error('transfer registry migration source has an invalid envelope');
  }
  const expectedKeyId = sha256(secret).slice(0, 16);
  if (registry.signature.keyId !== expectedKeyId) throw new Error('transfer registry migration keyId mismatch');
  const { signature, ...payload } = registry;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('transfer registry migration signature mismatch');
  }
  return registry;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  for (const key of ['registry', 'secret']) if (!values[key]) throw new Error(`--${key} is required`);
  return {
    registryPath: path.resolve(values.registry),
    secretPath: path.resolve(values.secret),
    agentId: values.agent || 'main',
    now: values.now || new Date().toISOString(),
  };
}

const CATEGORY_GUIDANCE = Object.freeze({
  algebra: ['Translate constraints into exact identities and preserve equivalence under each transformation.', 'Substitute the result into the original relation and check excluded values.', 'Expression growth and coefficient blow-up can dominate symbolic work.', 'Prefer exact arithmetic when the domain is discrete or rational.'],
  'algebra-precalculus': ['Normalize the expression, identify its domain, and preserve branch and singularity conditions.', 'Check algebraic identities at boundaries, poles, roots, and representative points.', 'Equivalent symbolic forms can have very different evaluation cost.', 'Guard cancellation, overflow, and branch-cut assumptions.'],
  functions: ['Make domain, codomain, composition order, and invertibility conditions explicit.', 'Check the defining relation and round-trip properties on domain boundaries.', 'Repeated composition can amplify time and representation size.', 'Track discontinuities and loss of injectivity.'],
  calculus: ['Identify regularity, limiting regime, and the valid differentiation or integration rule before computing.', 'Differentiate an antiderivative or compare limiting values and numerical quadrature.', 'Symbolic expansion and naive discretization can add avoidable cost.', 'Check singularities, cancellation, and discretization error.'],
  'linear-algebra': ['Represent the task with vectors, linear maps, rank, and an appropriate factorization rather than explicit inversion.', 'Check residuals, dimensions, rank, and reconstruction identities.', 'Dense cubic work may be avoidable through sparsity or structure.', 'Conditioning can amplify data and rounding error.'],
  'advanced-linear-algebra': ['Choose basis-free structure first, then coordinates or canonical forms suited to the operator.', 'Verify kernel/image, dimension, invariance, duality, or spectral identities.', 'Basis conversion and dense canonical forms can dominate cost.', 'Numerical eigenspaces need separation and conditioning checks.'],
  probability: ['Define the sample space, conditioning event, dependence assumptions, and target random variable.', 'Check normalization and compare exact enumeration with simulation when useful.', 'State-space enumeration can grow combinatorially.', 'Rare-event estimates need uncertainty and variance controls.'],
  'probability-statistics': ['State the sampling model, estimand, assumptions, and uncertainty measure before estimation.', 'Use calibration, resampling, or known-distribution checks appropriate to the estimator.', 'Resampling and large model matrices can be expensive.', 'Small samples and tail behavior can destabilize inference.'],
  statistics: ['Separate estimand, identification, estimator, uncertainty, and decision threshold.', 'Check calibration, residuals, coverage, sensitivity, and held-out behavior as applicable.', 'High-dimensional fitting and resampling can dominate runtime.', 'Ill conditioning, separation, and extreme weights can destabilize estimates.'],
  optimization: ['Write the objective, feasible set, variable domains, and optimality conditions explicitly.', 'Check feasibility, objective value, stationarity, and a bound or certificate.', 'Solver complexity depends on dimension, sparsity, and constraint structure.', 'Scaling and tolerance choices can create false convergence.'],
  'numerical-analysis-optimization': ['Choose a stable formulation and expose approximation, conditioning, stopping, and error controls.', 'Compare residuals and error estimates against a trusted reference or refinement.', 'Accuracy requirements determine discretization and iteration cost.', 'Track truncation, rounding, conditioning, and convergence separately.'],
  'discrete-mathematics': ['Model finite objects, relations, recurrences, or graph structure exactly.', 'Check invariants and exhaust small instances or compare with a closed form.', 'State spaces and combinatorial search can grow exponentially.', 'Use exact predicates and integer arithmetic.'],
  'combinatorics-graph-theory': ['Identify the discrete structure and choose a bijection, invariant, extremal bound, flow, or generating function.', 'Check constructions, counts, conservation laws, and tight examples.', 'Enumeration and graph search can be exponential without structure.', 'Use exact discrete checks; randomized methods need probability bounds.'],
  'number-theory': ['Reduce to exact divisibility, congruence, valuation, field, or arithmetic-function structure.', 'Verify every congruence, gcd, factorization, local condition, or rational point exactly.', 'Integer size and factorization complexity can dominate.', 'Floating-point arithmetic is invalid for exact arithmetic claims.'],
  'proof-foundations': ['State definitions, quantifiers, dependencies, and the exact proposition before selecting a proof method.', 'Check base cases, implications, witnesses, and counterexamples against the literal claim.', 'Proof search can branch rapidly; isolate the smallest sufficient lemma set.', 'Do not replace logical validity with numerical plausibility.'],
  'logic-set-theory': ['Fix syntax, semantics, axioms, model class, and metatheoretic assumptions.', 'Verify derivations or constructions against the declared formal system.', 'Model search and proof search may be undecidable or non-elementary.', 'Bounded checks are not general proofs.'],
  topology: ['Work from open-set, continuity, compactness, connectedness, and separation definitions before using invariants.', 'Verify maps, covers, neighborhoods, and counterexamples against definitions.', 'Combinatorial representations can grow with cover or complex size.', 'Metric intuition may fail in general topological spaces.'],
  'algebraic-topology': ['Choose a complex, filtration, homotopy, homology, or cohomology invariant suited to the space.', 'Check chain maps, boundaries, exactness, and invariant computations.', 'Boundary matrices and filtrations can become large.', 'Orientation, coefficient, and convergence choices affect results.'],
  'abstract-algebra': ['Identify the algebraic objects, morphisms, invariants, quotients, and universal properties.', 'Check closure, homomorphism laws, kernels, images, and canonical maps.', 'Normal forms and representation computations can grow quickly.', 'Use exact symbolic operations and explicit field/ring assumptions.'],
  'commutative-algebra': ['Translate geometry or equations into ideals, localizations, modules, spectra, or completions.', 'Check ideal membership, universal properties, dimensions, and decomposition identities.', 'Groebner and primary-decomposition procedures can be doubly exponential.', 'Coefficient domains and term orders must be explicit.'],
  'real-analysis': ['State the ambient space, quantifiers, regularity, convergence mode, and compactness/completeness hypotheses.', 'Check epsilon bounds, dominating estimates, and counterexamples when hypotheses weaken.', 'Approximation and covering arguments may require explicit rates.', 'Pointwise evidence does not establish uniform or measure convergence.'],
  'complex-analysis': ['Use holomorphic structure, contour geometry, singularities, and domain topology explicitly.', 'Check residues, contour orientation, analytic continuation, and boundary hypotheses.', 'Contour discretization and series truncation require error control.', 'Branch choices and near-singular evaluation can be unstable.'],
  'functional-analysis': ['Specify the normed/topological spaces, operator domains, boundedness, compactness, and dual pairing.', 'Check norm estimates, convergence mode, adjoints, and representation identities.', 'Infinite-dimensional arguments need justified approximation schemes.', 'Finite discretizations may hide unbounded or noncompact behavior.'],
  'harmonic-analysis': ['Choose physical/frequency representation, transform convention, localization, and function space.', 'Check inversion, Plancherel/energy identities, convolution, and scale behavior.', 'Transform and multiscale methods depend on sampling and sparsity.', 'Aliasing, leakage, truncation, and distributional inputs need explicit handling.'],
  'differential-equations-dynamical-systems': ['State the equation class, domain, boundary/initial data, regularity, and stability notion.', 'Check residuals, conservation/energy estimates, convergence, and known solutions.', 'Grid size, stiffness, and nonlinear iteration drive cost.', 'Discretization can change stability, invariants, and qualitative behavior.'],
  'measure-probability-stochastic': ['Fix measurable spaces, filtrations, laws, integrability, and conditioning assumptions.', 'Check measurability, normalization, martingale identities, moments, and limiting behavior.', 'Path simulation and high-dimensional integration can be expensive.', 'Tail events, stopping, and discretization require separate error analysis.'],
  'differential-geometry': ['Specify the manifold, charts, tensors, metric/connection, and coordinate-invariant target.', 'Check coordinate transformations, tensor identities, curvature, and integral invariants.', 'Chart transitions and tensor operations scale with dimension.', 'Coordinate singularities are not geometric singularities.'],
  'research-practice': ['Freeze the claim, corpus, assumptions, provenance, artifact boundary, and falsification conditions.', 'Require reproducible artifacts, dependency checks, contradiction search, and explicit non-claims.', 'Corpus and reproduction work should be bounded before execution.', 'Do not convert missing evidence into a positive claim.'],
  'error-analysis': ['Identify the hidden denominator, sample space, overlap, or claim boundary before calculating.', 'Recompute from explicit definitions and test the common misleading alternative.', 'Prefer the simplest exact formulation that exposes the error.', 'Rounding can conceal a conceptual denominator or conditioning mistake.'],
});

function guidanceFor(category) {
  return CATEGORY_GUIDANCE[category] || [
    'State the mathematical objects, assumptions, target, and valid transformations explicitly.',
    'Check the defining relations and a deterministic reference case.',
    'Choose an implementation compatible with input size and structure.',
    'Separate mathematical approximation from floating-point error.',
  ];
}

function contextFor(concept) {
  const [formulation, oracle, complexityRisk, numericalRisk] = guidanceFor(concept.category);
  const outcome = String(concept.outcomes?.[0] || `Apply ${concept.title}.`);
  const prerequisiteText = concept.prerequisites.length
    ? `Check prerequisites: ${concept.prerequisites.slice(0, 4).join(', ')}.`
    : 'No curriculum prerequisite is declared; still state task assumptions.';
  return {
    applicabilityReason: `${concept.title} (${concept.stage}); declared outcome: ${outcome}`.slice(0, 500),
    assumptions: [{ code: `grounded-${concept.conceptId}`.slice(0, 128), description: 'The request contains a grounded concept-title, outcome, or curated application match.' }],
    contraindications: ['Do not inject this concept from generic mathematical wording alone; reject it when its definitions or assumptions do not fit.'],
    computationalFormulation: `${formulation} Target outcome: ${outcome}`.slice(0, 500),
    implementationPatterns: [prerequisiteText.slice(0, 500), `Use the ${concept.category} structure explicitly; keep definitions and intermediate invariants inspectable.`],
    verificationOracle: oracle.slice(0, 500),
    complexityRisk: complexityRisk.slice(0, 500),
    numericalRisk: numericalRisk.slice(0, 500),
    truthBoundary: 'Operator-configured 264-concept retrieval guidance; verify the task result and do not infer retained mastery or PhD equivalence.',
  };
}

export function buildOperatorEntries({ now, allowedAgentIds, sourceDigest, planDigest }) {
  const activatedAt = new Date(now);
  if (!Number.isFinite(activatedAt.getTime())) throw new Error('invalid --now');
  const expiresAt = new Date(activatedAt.getTime() + 3653 * 24 * 60 * 60 * 1000).toISOString();
  return CATALOG.concepts.map((concept) => {
    const context = contextFor(concept);
    const matcherId = `phd-math-${concept.conceptId}-v1`;
    return {
      schemaVersion: TRANSFER_ENTRY_SCHEMA,
      entryId: `operator-phd-math-${concept.conceptId}-v1`,
      profileId: concept.conceptId,
      profileVersion: '1.0.0',
      conceptIds: [concept.conceptId],
      matcherId,
      enabled: true,
      qualificationState: 'operator_enabled',
      activationBasis: 'operator_direct',
      qualificationRunId: 'operator-direct-full-spectrum-20260808',
      artifactManifestDigest: sourceDigest,
      evidenceDigest: planDigest,
      profileDigest: digest({ concept, context, matcherId }),
      qualifiedAt: activatedAt.toISOString(),
      expiresAt,
      allowedAgentIds,
      context,
    };
  });
}

export function installOperatorEntries({ registryPath, secretPath, agentId = 'main', now = new Date().toISOString() }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(agentId)) throw new Error('invalid agent id');
  const productSources = ['transfer.mjs', 'transfer-registry.mjs', 'index.ts', 'phd-math-transfer-catalog.v1.json']
    .map((name) => fs.readFileSync(path.join(PLUGIN_ROOT, name)));
  const planSource = fs.readFileSync(path.join(PACKAGE_ROOT, 'plan.md'));
  const sourceDigest = sha256(Buffer.concat(productSources));
  const planDigest = sha256(planSource);

  if (!fs.existsSync(registryPath)) initializeTransferRegistry({ registryPath, secretPath, now });
  const secret = readTransferRegistrySecret(secretPath);
  const current = loadSignedRegistryEnvelopeForMigration(registryPath, secret);
  const entries = buildOperatorEntries({ now, allowedAgentIds: [agentId], sourceDigest, planDigest });
  const replaced = new Set(entries.map((entry) => entry.profileId));
  const independentEntries = current.entries.filter((entry) => entry.activationBasis !== 'operator_direct');
  const incompatibleIndependent = independentEntries.filter((entry) => !replaced.has(entry.profileId));
  if (incompatibleIndependent.length) {
    throw new Error(`refusing to discard incompatible independently qualified profiles: ${incompatibleIndependent.map((entry) => entry.profileId).join(', ')}`);
  }
  const preserved = independentEntries.filter((entry) => replaced.has(entry.profileId));
  const replacedLegacyOperatorCount = current.entries.length - independentEntries.length;
  const next = {
    schemaVersion: current.schemaVersion,
    revision: current.revision + 1,
    updatedAt: now,
    enabled: true,
    entries: [...preserved, ...entries].sort((left, right) => left.profileId.localeCompare(right.profileId)),
  };
  const signed = atomicWriteSignedTransferRegistry(registryPath, next, secret);
  return {
    registryPath,
    revision: signed.revision,
    keyId: signed.signature.keyId,
    catalogId: CATALOG.catalogId,
    catalogSourceDigest: CATALOG.source.sha256,
    installedProfileCount: entries.length,
    installedProfileIds: entries.map((entry) => entry.profileId).sort(),
    replacedLegacyOperatorCount,
    sourceDigest,
    planDigest,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = installOperatorEntries(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exitCode = 1;
  }
}
