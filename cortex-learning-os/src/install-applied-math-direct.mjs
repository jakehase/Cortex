#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TRANSFER_ENTRY_SCHEMA,
  atomicWriteSignedTransferRegistry,
  initializeTransferRegistry,
  loadSignedTransferRegistry,
  readTransferRegistrySecret,
} from '../../plugins/cortex-learning-os-live/transfer-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'cortex-learning-os-live');

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

const PROFILES = Object.freeze([
  {
    profileId: 'numerical-stability', matcherId: 'code-numerical-stability-v1',
    conceptIds: ['numerical-analysis-floating-point-error', 'numerical-analysis-conditioning'],
    context: {
      applicabilityReason: 'Finite-precision numerical code where conditioning or rounding can change results.',
      assumptions: [{ code: 'finite-precision', description: 'The implementation uses finite-precision arithmetic and accuracy matters.' }],
      contraindications: ['Do not replace an exact integer or symbolic requirement with floating-point arithmetic.'],
      computationalFormulation: 'Choose a stable equivalent formulation; scale inputs and avoid subtracting nearly equal values.',
      implementationPatterns: ['Use Welford or compensated updates for streaming moments.', 'Use log1p, expm1, or log-sum-exp near unstable boundaries.'],
      verificationOracle: 'Compare against high-precision/reference values on extreme-scale inputs.',
      complexityRisk: 'Prefer the stable linear-time formulation when available.',
      numericalRisk: 'Track overflow, underflow, cancellation, and condition sensitivity.',
      truthBoundary: 'Operator-configured guidance; mechanical routing only, not proven performance lift.',
    },
  },
  {
    profileId: 'network-flow-matching', matcherId: 'code-network-flow-matching-v1',
    conceptIds: ['graph-theory-matchings-flows', 'combinatorics-matroids'],
    context: {
      applicabilityReason: 'Capacitated assignment, matching, max-flow, or min-cut software problem.',
      assumptions: [{ code: 'graph-model', description: 'Entities and constraints can be represented as vertices, edges, and capacities.' }],
      contraindications: ['Do not force unrelated workflow or traffic wording into a graph model.'],
      computationalFormulation: 'Build a residual network; encode assignment as unit capacities when appropriate.',
      implementationPatterns: ['Use augmenting paths or Dinic for integral capacities.', 'Recover assignments from saturated forward edges.'],
      verificationOracle: 'Check capacity, conservation, assignment uniqueness, and matching cut/value.',
      complexityRisk: 'Choose the algorithm from graph size and capacity structure.',
      numericalRisk: 'Use exact integer capacities where the model is discrete.',
      truthBoundary: 'Operator-configured guidance; validate the graph reduction for the actual API.',
    },
  },
  {
    profileId: 'matrix-conditioning', matcherId: 'code-matrix-conditioning-v1',
    conceptIds: ['linear-algebra-matrix-decompositions', 'numerical-analysis-conditioning'],
    context: {
      applicabilityReason: 'Linear solve or least-squares code where rank and conditioning matter.',
      assumptions: [{ code: 'matrix-problem', description: 'The task is a numeric matrix solve, decomposition, or least-squares fit.' }],
      contraindications: ['Do not use matrix inversion when a direct solve suffices.'],
      computationalFormulation: 'Solve with QR; use pivoting or SVD when rank deficiency is possible.',
      implementationPatterns: ['Avoid normal equations for ill-conditioned least squares.', 'Scale columns and expose rank/tolerance decisions.'],
      verificationOracle: 'Check residual, rank behavior, and sensitivity on perturbed inputs.',
      complexityRisk: 'SVD is robust but costlier than QR.',
      numericalRisk: 'Condition number amplifies input and rounding error.',
      truthBoundary: 'Operator-configured guidance; library behavior and tolerances remain task-specific.',
    },
  },
  {
    profileId: 'constrained-optimization', matcherId: 'code-constrained-optimization-v1',
    conceptIds: ['optimization-duality-kkt'],
    context: {
      applicabilityReason: 'Constrained convex optimization or resource-allocation implementation.',
      assumptions: [{ code: 'convex-model', description: 'Objective, constraints, and variable domains are explicit; convexity is checked.' }],
      contraindications: ['KKT conditions are not automatically sufficient for nonconvex problems.'],
      computationalFormulation: 'Track primal feasibility, dual feasibility, stationarity, and complementarity.',
      implementationPatterns: ['Use a primal-dual solver with explicit residuals.', 'Normalize variables and constraints before solving.'],
      verificationOracle: 'Check constraint violations, objective, duality gap, and KKT residuals.',
      complexityRisk: 'Solver choice depends on sparsity and constraint structure.',
      numericalRisk: 'Poor scaling can create false convergence.',
      truthBoundary: 'Operator-configured guidance; no global-optimum claim without assumptions.',
    },
  },
  {
    profileId: 'stochastic-reliability', matcherId: 'code-stochastic-reliability-v1',
    conceptIds: ['stochastic-processes-markov-chains', 'differential-equations-stability-lyapunov'],
    context: {
      applicabilityReason: 'Retry, queue, failure, or steady-state behavior modeled by state transitions.',
      assumptions: [{ code: 'transition-model', description: 'States and transition probabilities are explicit and probabilities are normalized.' }],
      contraindications: ['Do not assume memorylessness when history affects transitions.'],
      computationalFormulation: 'Construct the transition matrix and separate transient, recurrent, and absorbing behavior.',
      implementationPatterns: ['Compute stationary behavior only after checking communicating classes.', 'Bound retries with an explicit absorbing failure/success state.'],
      verificationOracle: 'Check row sums, reachability, absorption probability, and simulation agreement.',
      complexityRisk: 'Exploit sparse transitions for large state spaces.',
      numericalRisk: 'Iterative stationary solves need convergence and residual checks.',
      truthBoundary: 'Operator-configured guidance; model validity is not established by code alone.',
    },
  },
  {
    profileId: 'state-invariants', matcherId: 'code-state-invariants-v1',
    conceptIds: ['proof-invariants-and-extremal-principles', 'proof-counterexample-construction'],
    context: {
      applicabilityReason: 'State-machine or protocol safety implementation needing an inductive invariant.',
      assumptions: [{ code: 'explicit-transitions', description: 'Initial states, transitions, and forbidden states are explicit.' }],
      contraindications: ['A bounded search that finds no counterexample is not a general proof.'],
      computationalFormulation: 'State the invariant; verify initialization, preservation, and implication of safety.',
      implementationPatterns: ['Assert the invariant at transition boundaries.', 'Minimize counterexample traces before changing the design.'],
      verificationOracle: 'Exhaust reachable small states and check base/step obligations.',
      complexityRisk: 'State explosion requires symmetry, abstraction, or compositional invariants.',
      numericalRisk: 'Use exact state predicates rather than tolerant equality.',
      truthBoundary: 'Operator-configured guidance; no formal-proof claim without a trusted proof checker.',
    },
  },
  {
    profileId: 'causal-analysis', matcherId: 'code-causal-analysis-v1',
    conceptIds: ['statistics-causal-identification'],
    context: {
      applicabilityReason: 'Software estimating a causal treatment effect rather than prediction alone.',
      assumptions: [{ code: 'identification', description: 'Treatment, outcome, timing, and identification assumptions are explicit.' }],
      contraindications: ['Prediction accuracy does not establish causal identification.'],
      computationalFormulation: 'Encode the causal graph and adjustment set before choosing an estimator.',
      implementationPatterns: ['Avoid conditioning on descendants or colliders.', 'Separate identification, estimation, and sensitivity analysis.'],
      verificationOracle: 'Check temporal order, overlap, balance, placebo outcomes, and sensitivity.',
      complexityRisk: 'Use cross-fitting when flexible nuisance models risk overfit.',
      numericalRisk: 'Extreme propensity weights create unstable estimates.',
      truthBoundary: 'Operator-configured guidance; causal conclusions remain assumption-dependent.',
    },
  },
  {
    profileId: 'modular-reconstruction', matcherId: 'code-modular-reconstruction-v1',
    conceptIds: ['number-theory-chinese-remainder'],
    context: {
      applicabilityReason: 'Exact software reconstruction from congruences over coprime moduli.',
      assumptions: [{ code: 'compatible-congruences', description: 'Residues are compatible and modulus conditions are checked.' }],
      contraindications: ['Do not assume pairwise coprimality; use generalized CRT when gcds are nontrivial.'],
      computationalFormulation: 'Combine congruences with extended-gcd inverses and normalize to the product modulus.',
      implementationPatterns: ['Use arbitrary-precision integers.', 'Check compatibility before merging non-coprime moduli.'],
      verificationOracle: 'Verify the result modulo every input modulus and normalize the representative.',
      complexityRisk: 'Merge incrementally to limit intermediate work.',
      numericalRisk: 'Floating-point arithmetic is invalid for exact congruences.',
      truthBoundary: 'Operator-configured guidance; cryptographic constant-time needs are separate.',
    },
  },
]);

export function buildOperatorEntries({ now, allowedAgentIds, sourceDigest, planDigest }) {
  const qualifiedAt = new Date(now);
  if (!Number.isFinite(qualifiedAt.getTime())) throw new Error('invalid --now');
  const expiresAt = new Date(qualifiedAt.getTime() + 366 * 24 * 60 * 60 * 1000).toISOString();
  return PROFILES.map((profile) => ({
    schemaVersion: TRANSFER_ENTRY_SCHEMA,
    entryId: `operator-applied-math-${profile.profileId}-v1`,
    profileId: profile.profileId,
    profileVersion: '1.0.0',
    conceptIds: profile.conceptIds,
    matcherId: profile.matcherId,
    enabled: true,
    qualificationState: 'operator_enabled',
    activationBasis: 'operator_direct',
    qualificationRunId: 'operator-direct-applied-math-20260808',
    artifactManifestDigest: sourceDigest,
    evidenceDigest: planDigest,
    profileDigest: digest(profile),
    qualifiedAt: qualifiedAt.toISOString(),
    expiresAt,
    allowedAgentIds,
    context: profile.context,
  }));
}

export function installOperatorEntries({ registryPath, secretPath, agentId = 'main', now = new Date().toISOString() }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(agentId)) throw new Error('invalid agent id');
  const transferSource = fs.readFileSync(path.join(PLUGIN_ROOT, 'transfer.mjs'));
  const registrySource = fs.readFileSync(path.join(PLUGIN_ROOT, 'transfer-registry.mjs'));
  const planSource = fs.readFileSync(path.join(PACKAGE_ROOT, 'plan.md'));
  const sourceDigest = sha256(Buffer.concat([transferSource, registrySource]));
  const planDigest = sha256(planSource);

  initializeTransferRegistry({ registryPath, secretPath, now });
  const secret = readTransferRegistrySecret(secretPath);
  const current = loadSignedTransferRegistry(registryPath, secret, { allowExpiredEntries: true });
  const entries = buildOperatorEntries({ now, allowedAgentIds: [agentId], sourceDigest, planDigest });
  const replaced = new Set(entries.map((entry) => entry.profileId));
  const next = {
    schemaVersion: current.schemaVersion,
    revision: current.revision + 1,
    updatedAt: now,
    enabled: true,
    entries: [...current.entries.filter((entry) => !replaced.has(entry.profileId)), ...entries]
      .sort((left, right) => left.profileId.localeCompare(right.profileId)),
  };
  const signed = atomicWriteSignedTransferRegistry(registryPath, next, secret);
  return {
    registryPath,
    revision: signed.revision,
    keyId: signed.signature.keyId,
    installedProfileIds: entries.map((entry) => entry.profileId).sort(),
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
