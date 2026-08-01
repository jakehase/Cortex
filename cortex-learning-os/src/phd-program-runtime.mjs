import fs from 'node:fs';
import path from 'node:path';

import { validateAdaptivePolicy } from './adaptive-policy.mjs';
import { buildDeploymentBinding } from './deployment-identity.mjs';
import { validateGeneratedExerciseCoverage } from './generated-exercises.mjs';
import { sha256Bytes } from './hash.mjs';
import { validatePhdProgram } from './phd-competency.mjs';
import { loadProofObligationRegistry } from './phd-proof-registry.mjs';
import { validateRetentionPolicy } from './phd-retention.mjs';
import { validatePhdTrustPolicy } from './phd-trust.mjs';
import {
  assertCommitTree,
  assertExecutionClosureAtRoot,
  buildCommittedExecutionClosure,
  buildWorkingTreeExecutionClosure,
  readCommittedProductFile,
  readCommittedProductJson,
  readExecutionClosureFileAtRoot,
  validateExecutionClosure,
} from './git-product-source.mjs';
import { CLOS_ROOT } from './paths.mjs';

export const CANONICAL_PHD_PROGRAM_SCHEMA = 'cortex.learning_os.canonical_phd_program.v1';

function readWorkingTree(relative) {
  return JSON.parse(fs.readFileSync(path.join(CLOS_ROOT, relative), 'utf8'));
}

function loadCanonicalPhdProgramFromReaders({
  sourceCommit,
  sourceTree,
  productTree,
  readJson,
  readBytes,
  executionClosure,
  sourceMode,
}) {
  const legacyGraph = readJson('capsules/math-foundations/curriculum.continuous-acquisition-v1.graph.json');
  const graph = readJson('capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json');
  const rubric = readJson('capsules/math-foundations/phd-competency-rubric.v1.json');
  const blueprint = readJson('capsules/math-foundations/phd-qualifying-blueprint.v1.json');
  const acquisitionPolicy = readJson('policies/adaptive-math-phd-v1.json');
  const legacyAcquisitionPolicy = readJson('policies/adaptive-math-continuous-v1.json');
  const retentionPolicy = readJson('policies/phd-retention-v1.json');
  const trustPolicy = readJson('policies/phd-production-trust.v1.json');
  const program = validatePhdProgram({ graph, rubric, blueprint, legacyGraph });
  const acquisitionValidation = validateAdaptivePolicy(acquisitionPolicy);
  const retentionValidation = validateRetentionPolicy(retentionPolicy);
  const assessmentCoverage = validateGeneratedExerciseCoverage(graph);
  const proofTemplates = Object.fromEntries([
    'formal-proof-induction-well-ordering',
    'formal-proof-rank-nullity',
    'formal-proof-monotone-convergence',
    'formal-proof-first-isomorphism',
    'formal-proof-compact-image',
    'formal-proof-conditional-tower',
    'formal-proof-research-main-result',
  ].map((obligationId) => [
    obligationId,
    readBytes(`proof-kernel/templates/${obligationId}.template.lean`),
  ]));
  const proofRegistry = loadProofObligationRegistry({ rubric, templatesByObligation: proofTemplates });
  const proofRuntimeProductManifest = [
    'proof-kernel/lean-toolchain',
    'proof-kernel/lakefile.toml',
    'proof-kernel/ProofKernel.lean',
    'proof-kernel/ProofKernel/Prelude.lean',
    'proof-kernel/ProofKernel/Representative.lean',
  ].map((relative) => {
    const bytes = readBytes(relative);
    return {
      path: relative.slice('proof-kernel/'.length),
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
    };
  });
  const trustValidation = validatePhdTrustPolicy(trustPolicy);
  const productionTrustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
  const errors = [
    ...program.errors.map((error) => `program: ${error}`),
    ...acquisitionValidation.errors.map((error) => `acquisition policy: ${error}`),
    ...retentionValidation.errors.map((error) => `retention policy: ${error}`),
    ...assessmentCoverage.missing.map((conceptId) => `assessment surface missing: ${conceptId}`),
    ...trustValidation.errors.map((error) => `trust policy: ${error}`),
  ];
  if (acquisitionPolicy.curriculumId !== graph.curriculumId
      || acquisitionPolicy.capsuleId !== graph.capsuleId) {
    errors.push('active acquisition policy scope does not match the PhD graph');
  }
  if (retentionPolicy.curriculumId !== graph.curriculumId
      || retentionPolicy.capsuleId !== graph.capsuleId) {
    errors.push('retention policy scope does not match the PhD graph');
  }
  const deployment = buildDeploymentBinding({
    sourceCommit,
    sourceTree,
    productTree,
    executionClosure,
    artifacts: {
      graph,
      rubric,
      blueprint,
      'acquisition-policy': acquisitionPolicy,
      'retention-policy': retentionPolicy,
      'trust-policy': trustPolicy,
      'assessment-runtime': readBytes('src/phd-assessment.mjs'),
      'assessment-item-schema': readBytes('schemas/independent-assessment-item-v1.schema.json'),
      'assessment-bank-schema': readBytes('schemas/independent-assessment-bank-v1.schema.json'),
      'assessment-registry-schema': readBytes('schemas/acquisition-assessment-registry.schema.json'),
      'execution-evidence-runtime': readBytes('src/execution-evidence.mjs'),
      'execution-evidence-schema': readBytes('schemas/execution-evidence-core.schema.json'),
      'proof-registry': proofRegistry,
      'proof-runtime-product': proofRuntimeProductManifest,
    },
  });
  return {
    schemaVersion: CANONICAL_PHD_PROGRAM_SCHEMA,
    ok: errors.length === 0,
    errors,
    graph,
    legacyGraph,
    rubric,
    blueprint,
    acquisitionPolicy,
    legacyAcquisitionPolicy,
    retentionPolicy,
    trustPolicy,
    program,
    proofRegistry,
    deployment,
    assessmentCoverage: {
      conceptCount: graph.concepts.length,
      generatedFixtureMechanicsConceptCount: graph.concepts.length - assessmentCoverage.missing.length,
      advancedConceptSpecificProductionSurfaceCount: 0,
      productionAssessmentSchemaReady: true,
      externallySuppliedSignedBankCount: 0,
      productionAssessmentRegistryReady: false,
      missingConceptIds: assessmentCoverage.missing,
      productionBlockers: [
        'No independently authored, independently reviewed, signed acquisition bank is committed or externally supplied.',
        'No independently authored, independently reviewed, signed retention banks are committed or externally supplied.',
        'The checked-in production trust policy has no configured independent authority keys.',
      ],
      truthBoundary: 'The runtime and schemas can ingest signed independent banks, but none are present. Generated exercise replay coverage remains fixture mechanics only and cannot qualify acquisition, retention, or PhD capability.',
    },
    sourceMode,
    productionTrustReady: sourceMode !== 'working_tree_fixture'
      && productionTrustValidation.ok,
    productionTrustBlockers: sourceMode === 'working_tree_fixture'
      ? ['Working-tree fixture bytes are not an immutable production source.']
      : productionTrustValidation.errors,
    truthBoundary: sourceMode === 'signed_immutable_checkout'
      ? 'This manifest loads canonical bytes through the signed root-owned immutable checkout closure. Validation, disabled trust roots, synthetic fixtures, or generated acquisition exercises are not evidence of learning or capability.'
      : 'This manifest loads canonical bytes from the declared Git commit. Validation, disabled trust roots, synthetic fixtures, or generated acquisition exercises are not evidence of learning or capability.',
  };
}

export function loadCanonicalPhdProgram({
  sourceCommit,
  sourceTree,
  productTree = sourceTree,
  allowWorkingTreeFixtures = false,
} = {}) {
  if (!allowWorkingTreeFixtures) assertCommitTree(sourceCommit, sourceTree, productTree);
  const executionClosure = allowWorkingTreeFixtures
    ? buildWorkingTreeExecutionClosure({ sourceCommit, sourceTree, productTree })
    : buildCommittedExecutionClosure({ sourceCommit, sourceTree, productTree });
  return loadCanonicalPhdProgramFromReaders({
    sourceCommit,
    sourceTree,
    productTree,
    readJson: allowWorkingTreeFixtures
      ? readWorkingTree
      : (relative) => readCommittedProductJson(sourceCommit, relative),
    readBytes: allowWorkingTreeFixtures
      ? (relative) => fs.readFileSync(path.join(CLOS_ROOT, relative))
      : (relative) => readCommittedProductFile(sourceCommit, relative),
    executionClosure,
    sourceMode: allowWorkingTreeFixtures ? 'working_tree_fixture' : 'exact_git_blobs',
  });
}

export function loadCanonicalPhdProgramFromCheckout({
  sourceCommit,
  sourceTree,
  productTree,
  executionClosure,
  checkoutRoot,
} = {}) {
  const validation = validateExecutionClosure(executionClosure);
  if (!validation.ok
      || executionClosure.immutable !== true
      || executionClosure.sourceCommit !== sourceCommit
      || executionClosure.sourceTree !== sourceTree
      || executionClosure.productTree !== productTree) {
    throw new Error('canonical PhD program immutable checkout identity is invalid');
  }
  assertExecutionClosureAtRoot(executionClosure, checkoutRoot);
  const readBytes = (relative) => readExecutionClosureFileAtRoot(
    executionClosure,
    checkoutRoot,
    `cortex-learning-os/${relative}`,
  );
  const readJson = (relative) => {
    try {
      return JSON.parse(readBytes(relative).toString('utf8'));
    } catch (error) {
      throw new Error(`immutable canonical PhD program JSON is invalid at ${relative}: ${error.message}`);
    }
  };
  return loadCanonicalPhdProgramFromReaders({
    sourceCommit,
    sourceTree,
    productTree,
    readJson,
    readBytes,
    executionClosure: structuredClone(executionClosure),
    sourceMode: 'signed_immutable_checkout',
  });
}
