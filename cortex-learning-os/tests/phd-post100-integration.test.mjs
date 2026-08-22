import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  validateProductionQualificationBank,
} from '../src/phd-campaign.mjs';
import {
  researchSourceBundleDigest,
  validateResearchReproductionTask,
  validateResearchSourceBundle,
} from '../src/frozen-research-reproduction.mjs';
import { sha256Bytes, sha256Text } from '../src/hash.mjs';
import { loadCanonicalPhdProgram } from '../src/phd-program-runtime.mjs';
import {
  loadProofObligationRegistry,
  materializeProofTemplate,
} from '../src/phd-proof-registry.mjs';
import { buildLayeredPhdStatus } from '../src/phd-status.mjs';
import { CLOS_ROOT } from '../src/paths.mjs';

const runtime = loadCanonicalPhdProgram({
  sourceCommit: 'a'.repeat(40),
  sourceTree: 'b'.repeat(40),
  allowWorkingTreeFixtures: true,
});

function digest(value) {
  return sha256Text(canonicalJson(value));
}

test('canonical JSON refuses values that do not have one exact JSON byte encoding', () => {
  assert.throws(() => canonicalJson({ omitted: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ nonfinite: Number.POSITIVE_INFINITY }), /finite/);
  assert.throws(() => canonicalJson(new Map()), /plain objects/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalJson(sparse), /sparse/);
  const symbolField = { visible: true };
  symbolField[Symbol('hidden')] = true;
  assert.throws(() => canonicalJson(symbolField), /symbols/);
  const accessor = {};
  Object.defineProperty(accessor, 'derived', { enumerable: true, get: () => true });
  assert.throws(() => canonicalJson(accessor), /accessors/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cyclic/);
});

test('proof registry binds exactly seven valid UTF-8 templates to fixed obligations', () => {
  const templates = Object.fromEntries(runtime.proofRegistry.entries.map(({ obligationId }) => [
    obligationId,
    fs.readFileSync(path.join(
      CLOS_ROOT,
      'proof-kernel/templates',
      `${obligationId}.template.lean`,
    )),
  ]));
  assert.equal(loadProofObligationRegistry({
    rubric: runtime.rubric,
    templatesByObligation: templates,
  }).entries.length, 7);

  const extra = { ...templates, 'unapproved-obligation': Buffer.from('x'.repeat(200)) };
  assert.throws(() => loadProofObligationRegistry({
    rubric: runtime.rubric,
    templatesByObligation: extra,
  }), /exactly seven/);

  const malformed = Object.fromEntries(
    Object.entries(templates).map(([key, value]) => [key, Buffer.from(value)]),
  );
  malformed['formal-proof-rank-nullity'][20] = 0xff;
  assert.throws(() => loadProofObligationRegistry({
    rubric: runtime.rubric,
    templatesByObligation: malformed,
  }), /valid UTF-8/);

  const substituted = Object.fromEntries(
    Object.entries(templates).map(([key, value]) => [key, Buffer.from(value)]),
  );
  substituted['formal-proof-compact-image'] = Buffer.from(
    substituted['formal-proof-compact-image']
      .toString('utf8')
      .replace('candidate_compact_image', 'candidate_rank_nullity'),
  );
  assert.throws(() => loadProofObligationRegistry({
    rubric: runtime.rubric,
    templatesByObligation: substituted,
  }), /does not match its obligation/);

  assert.throws(() => materializeProofTemplate({
    obligationId: 'formal-proof-compact-image',
    frozenTemplateBytes: templates['formal-proof-compact-image'],
  }), /require expected template and theorem digests/);
});

test('research source and reproduction schemas close path, type, and extension ambiguity', () => {
  const bytes = Buffer.from('console.log("bounded research fixture");\n');
  const sourceBundle = {
    schemaVersion: 'cortex.learning_os.research_source_bundle.v1',
    files: [{
      path: 'src/main.mjs',
      bytesBase64: bytes.toString('base64'),
      sha256: sha256Bytes(bytes),
      executable: false,
    }],
  };
  assert.equal(validateResearchSourceBundle(sourceBundle).ok, true);
  assert.equal(validateResearchSourceBundle({
    ...sourceBundle,
    unapproved: true,
  }).ok, false);
  assert.equal(validateResearchSourceBundle({
    ...sourceBundle,
    files: [{ ...sourceBundle.files[0], executable: 'false' }],
  }).ok, false);
  assert.equal(validateResearchSourceBundle({
    ...sourceBundle,
    files: [{ ...sourceBundle.files[0], path: 'src/../main.mjs' }],
  }).ok, false);

  const environment = {
    executionKind: 'host_fixture',
    lockDigest: '1'.repeat(64),
    immutable: true,
    networkDisabled: true,
  };
  const command = ['node', 'src/main.mjs'];
  const task = {
    schemaVersion: 'cortex.learning_os.research_reproduction_task.v1',
    campaignId: 'bounded-research',
    candidateJobId: 'bounded-research.candidate',
    candidateSessionId: 'bounded-research-session',
    candidatePromptSha256: '2'.repeat(64),
    fixtureOnly: true,
    approvedResearchRuntime: null,
    approvedResearchRuntimeSha256: null,
    sourceBundle,
    sourceBundleSha256: researchSourceBundleDigest(sourceBundle),
    environment,
    environmentDigest: digest(environment),
    command,
    commandDigest: digest(command),
    outputPaths: ['out/result.json'],
    resultPath: 'out/result.json',
    timeoutSeconds: 30,
  };
  assert.equal(validateResearchReproductionTask(task).ok, true);
  assert.equal(validateResearchReproductionTask({
    ...task,
    unapproved: true,
  }).ok, false);
  assert.equal(validateResearchReproductionTask({
    ...task,
    outputPaths: ['out/result.json', 'out/result.json'],
  }).ok, false);
});

test('working-tree and fixture retention inputs cannot render production readiness', () => {
  const status = buildLayeredPhdStatus({
    program: {
      ...runtime,
      ok: true,
      sourceMode: 'working_tree_fixture',
      productionTrustReady: true,
    },
    retentionStatus: {
      fixtureOnly: true,
      status: 'retained_mastery_qualified',
      retainedMasteryQualified: true,
    },
    retentionStatusVerified: true,
    proofPreflight: { status: 'absent' },
  });
  assert.equal(status.program.status, 'structurally_valid_production_blocked');
  assert.equal(status.program.productionTrustReady, false);
  assert.equal(status.retention.status, 'unverified');
  assert.equal(status.retention.retainedMasteryQualified, false);
  assert.equal(status.phd_math_qualified, false);
});

test('sealed family checks derive reserved state and commit no rejected bank families', () => {
  const mapping = runtime.rubric.conceptMappings.find(
    (row) => row.stage === 'specialization',
  );
  const concept = runtime.graph.concepts.find(
    (row) => row.conceptId === mapping.conceptId,
  );
  const track = mapping.tracks[0];
  const familyId = 'post100-family-one';
  const item = {
    itemId: 'post100-qualification-item',
    prompt: 'State a bounded graduate argument.',
    answerFormat: 'text',
    checker: { mode: 'string', expected: 'bounded' },
    qualification: {
      conceptId: concept.conceptId,
      difficulty: 'graduate_qualifying',
      theoremFamilyId: familyId,
      tracks: [track],
      outcomeIds: [`outcome:${sha256Text(concept.outcomes[0])}`],
    },
  };
  const items = [item];
  const acquisitionAssessmentRegistry = [];
  const qualificationFamilyLedger = { theoremFamilyIds: [] };
  const bank = {
    schemaVersion: 'cortex.learning_os.sealed_exam_bank.v2',
    fixtureOnly: false,
    examId: 'post100-specialization',
    examVersion: '1.0.0',
    kind: 'specialization',
    items,
    bankDigest: digest(items),
    keyDigest: digest(items.map((row) => ({ itemId: row.itemId, checker: row.checker }))),
    provenance: {
      mode: 'independently_authored_expert_reviewed',
      unavailableDuringAcquisition: true,
      acquisitionFamilyDisjoint: true,
      priorCampaignFamilyDisjoint: true,
      acquisitionAssessmentRegistryDigest: digest(acquisitionAssessmentRegistry),
      priorQualificationFamilyLedgerDigest: digest(qualificationFamilyLedger),
      authorIds: ['author-one'],
      expertReviewerIds: ['reviewer-one'],
    },
    authorityAttestation: null,
    expertReviewAttestation: null,
  };
  const spec = {
    examId: bank.examId,
    version: bank.examVersion,
    minimumProblemCount: 1,
    tracks: [track],
  };
  const usedFamilies = new Set();
  const rejected = validateProductionQualificationBank({
    bank,
    spec,
    kind: 'specialization',
    graph: runtime.graph,
    rubric: runtime.rubric,
    trustPolicy: runtime.trustPolicy,
    declaredSpecializationTracks: [track],
    acquisitionAssessmentRegistry,
    qualificationFamilyLedger,
    usedFamilies,
  });
  assert.equal(rejected.ok, false);
  assert.equal(usedFamilies.size, 0);

  const collision = validateProductionQualificationBank({
    bank: {
      ...bank,
      provenance: {
        ...bank.provenance,
        acquisitionAssessmentRegistryDigest: digest([{ theoremFamilyId: familyId }]),
      },
    },
    spec,
    kind: 'specialization',
    graph: runtime.graph,
    rubric: runtime.rubric,
    trustPolicy: runtime.trustPolicy,
    declaredSpecializationTracks: [track],
    acquisitionAssessmentRegistry: [{ theoremFamilyId: familyId }],
    qualificationFamilyLedger,
    usedFamilies: new Set(),
  });
  assert.match(collision.errors.join('; '), /theorem family is not disjoint/);
});
