import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PHD_EVIDENCE_SCHEMA,
  canonicalDigest,
  canonicalJson,
  computePhdCapabilityReport,
  validatePhdBlueprint,
  validatePhdProgram,
  validatePhdRubric,
  validatePhdTrajectory,
} from '../src/phd-competency.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const legacyGraph = read('capsules/math-foundations/curriculum.continuous-acquisition-v1.graph.json');
const graph = read('capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json');
const rubric = read('capsules/math-foundations/phd-competency-rubric.v1.json');
const blueprint = read('capsules/math-foundations/phd-qualifying-blueprint.v1.json');
const trajectorySchema = read('schemas/phd-trajectory-v1.schema.json');
const rubricSchema = read('schemas/phd-competency-rubric-v1.schema.json');
const blueprintSchema = read('schemas/phd-qualifying-blueprint-v1.schema.json');
const program = validatePhdProgram({ graph, rubric, blueprint, legacyGraph });

const subjectId = 'synthetic-candidate-v1';
const evaluatedAt = '2026-08-01T18:00:00.000Z';
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const clone = (value) => structuredClone(value);
const normalize = (value) => String(value)
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function examAttempt(spec, index, evidenceId = `exam:${spec.examId}`) {
  const hour = String(8 + index).padStart(2, '0');
  return {
    evidenceId,
    subjectId,
    examId: spec.examId,
    examVersion: spec.version,
    examSpecDigest: program.examSpecDigests[spec.examId],
    score: 0.9,
    passed: true,
    startedAt: `2026-07-30T${hour}:02:00.000Z`,
    completedAt: `2026-07-30T${hour}:42:00.000Z`,
    solutionDigest: digest(`solution:${spec.examId}`),
    proctorId: `independent-proctor-${index}`,
    unseenProtocol: {
      itemBankSealed: true,
      candidateNoPriorAccess: true,
      promptCommitmentDigest: digest(`prompt:${spec.examId}`),
      commitmentRecordedAt: `2026-07-30T${hour}:00:00.000Z`,
      promptReleasedAt: `2026-07-30T${hour}:01:00.000Z`,
      independentProctor: true,
    },
  };
}

function formalProofEvidence(researchArtifactDigest) {
  return rubric.formalProofObligations.map((obligation, index) => ({
    evidenceId: `proof:${obligation.obligationId}`,
    subjectId,
    obligationId: obligation.obligationId,
    obligationSpecDigest: program.proofObligationSpecDigests[obligation.obligationId],
    kernel: obligation.acceptedKernels[0],
    kernelVersion: '4.22.0',
    proofArtifactDigest: digest(`proof-artifact:${obligation.obligationId}`),
    kernelOutputDigest: digest(`kernel-output:${obligation.obligationId}`),
    checkedAt: `2026-07-31T${String(8 + index).padStart(2, '0')}:00:00.000Z`,
    status: 'kernel_checked',
    researchArtifactDigest: obligation.researchArtifactBound ? researchArtifactDigest : null,
  }));
}

function syntheticEvidence({
  includeQualifying = true,
  includeProofs = true,
  includeSpecialization = true,
  includeResearch = true,
  coverAllConcepts = true,
  noveltyStatus = 'bounded_corpus_only',
} = {}) {
  const researchArtifactDigest = digest('bounded-research-artifact');
  const conceptIds = coverAllConcepts
    ? graph.concepts.map((concept) => concept.conceptId)
    : rubric.conceptMappings
      .filter((mapping) => mapping.requiredForQualification)
      .map((mapping) => mapping.conceptId);
  const formalProofs = includeProofs ? formalProofEvidence(researchArtifactDigest) : [];
  const researchProof = formalProofs.find((proof) => {
    const obligation = rubric.formalProofObligations
      .find((candidate) => candidate.obligationId === proof.obligationId);
    return obligation.researchArtifactBound;
  });
  return {
    schemaVersion: PHD_EVIDENCE_SCHEMA,
    subjectId,
    evaluatedAt,
    programDigests: { ...program.digests },
    acquisition: {
      conceptEvidence: conceptIds.map((conceptId) => ({
        evidenceId: `coverage:${conceptId}`,
        subjectId,
        conceptId,
        status: 'covered',
        assessedAt: '2026-07-29T12:00:00.000Z',
        assessmentDigest: digest(`assessment:${conceptId}`),
        independentAssessmentCount: 1,
      })),
    },
    qualifying: {
      examAttempts: includeQualifying
        ? blueprint.coreExams.map((exam, index) => examAttempt(exam, index))
        : [],
    },
    formalProofs,
    specialization: {
      declaredTracks: ['real-analysis'],
      examAttempt: includeSpecialization
        ? examAttempt(blueprint.specializationExam, 5, 'exam:specialization')
        : null,
    },
    research: includeResearch ? {
      evidenceId: 'research:bounded-artifact',
      subjectId,
      artifactId: 'bounded-research-artifact-v1',
      artifactDigest: researchArtifactDigest,
      boundedClaim: 'For the frozen finite operator family, the declared convergence bound holds.',
      corpus: {
        description: 'Frozen dated corpus for the bounded operator-family result.',
        corpusDigest: digest('research-corpus'),
        protocolDigest: digest('corpus-search-protocol'),
      },
      reproduction: {
        status: 'passed',
        independent: true,
        reproducerId: 'independent-reproducer-v1',
        environmentDigest: digest('research-environment'),
        resultDigest: digest('reproduction-result'),
        completedAt: '2026-08-01T14:00:00.000Z',
      },
      review: {
        status: 'passed',
        independent: true,
        reviewerId: 'independent-reviewer-v1',
        reviewDigest: digest('research-review'),
        completedAt: '2026-08-01T15:00:00.000Z',
      },
      formalProofEvidenceIds: [researchProof?.evidenceId].filter(Boolean),
      novelty: {
        status: noveltyStatus,
        scopeStatement: noveltyStatus === 'bounded_corpus_only'
          ? 'No matching result was found only in the frozen declared corpus.'
          : 'The declared status is scoped to its recorded external evidence.',
        evidenceDigest: digest(`novelty:${noveltyStatus}`),
      },
      completedAt: '2026-08-01T16:00:00.000Z',
    } : null,
  };
}

test('trajectory preserves the exact 84-concept legacy prefix and contains 264 static concepts', () => {
  assert.equal(legacyGraph.concepts.length, 84);
  assert.equal(graph.concepts.length, 264);
  assert.equal(graph.legacyPrefix.conceptCount, 84);
  for (let index = 0; index < legacyGraph.concepts.length; index += 1) {
    assert.equal(canonicalJson(graph.concepts[index]), canonicalJson(legacyGraph.concepts[index]));
  }
  assert.equal(validatePhdTrajectory(graph, legacyGraph).ok, true);

  const changed = clone(graph);
  changed.concepts[0].outcomes[0] = 'Rewritten legacy outcome.';
  assert.match(validatePhdTrajectory(changed, legacyGraph).errors.join('\n'), /legacy concept changed or moved/);
});

test('trajectory is a forward-ordered DAG with stable IDs and normalized-unique titles and outcomes', () => {
  const positions = new Map(graph.concepts.map((concept, index) => [concept.conceptId, index]));
  assert.equal(positions.size, graph.concepts.length);
  const indegree = new Map(graph.concepts.map((concept) => [concept.conceptId, 0]));
  const dependents = new Map(graph.concepts.map((concept) => [concept.conceptId, []]));
  for (const [index, concept] of graph.concepts.entries()) {
    assert.match(concept.conceptId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const prerequisite of concept.prerequisites) {
      assert.ok(positions.has(prerequisite), `${concept.conceptId} has unknown prerequisite ${prerequisite}`);
      assert.ok(positions.get(prerequisite) < index, `${concept.conceptId} points forward to ${prerequisite}`);
      indegree.set(concept.conceptId, indegree.get(concept.conceptId) + 1);
      dependents.get(prerequisite).push(concept.conceptId);
    }
  }
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([conceptId]) => conceptId);
  let visited = 0;
  while (ready.length) {
    const conceptId = ready.shift();
    visited += 1;
    for (const dependent of dependents.get(conceptId)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) ready.push(dependent);
    }
  }
  assert.equal(visited, graph.concepts.length);
  const titleKeys = graph.concepts.map((concept) => normalize(concept.title));
  const outcomeKeys = graph.concepts.flatMap((concept) => concept.outcomes.map(normalize));
  assert.equal(new Set(titleKeys).size, titleKeys.length);
  assert.equal(new Set(outcomeKeys).size, outcomeKeys.length);

  const pointsForward = clone(graph);
  pointsForward.concepts[84].prerequisites = [graph.concepts.at(-1).conceptId];
  assert.match(validatePhdTrajectory(pointsForward, legacyGraph).errors.join('\n'), /does not precede/);
  const duplicateOutcome = clone(graph);
  duplicateOutcome.concepts.at(-1).outcomes = [...graph.concepts[0].outcomes];
  assert.match(validatePhdTrajectory(duplicateOutcome, legacyGraph).errors.join('\n'), /duplicate normalized outcome/);
});

test('rubric maps every concept exactly once across all six stages and every required broad track', () => {
  const requiredStages = [
    'proof_foundations', 'undergraduate_core', 'graduate_core',
    'qualifying', 'specialization', 'research',
  ];
  const requiredTracks = [
    'proof-foundations',
    'advanced-linear-algebra',
    'real-analysis',
    'complex-analysis',
    'functional-analysis',
    'harmonic-analysis',
    'abstract-algebra',
    'commutative-algebra',
    'topology',
    'algebraic-topology',
    'differential-geometry',
    'differential-equations-dynamical-systems',
    'measure-probability-stochastic',
    'statistics',
    'combinatorics-graph-theory',
    'number-theory',
    'logic-set-theory',
    'numerical-analysis-optimization',
    'research-practice',
  ];
  assert.deepEqual(rubric.stages.map((stage) => stage.stageId), requiredStages);
  assert.deepEqual(rubric.tracks.map((track) => track.trackId), requiredTracks);
  assert.equal(rubric.conceptMappings.length, graph.concepts.length);
  assert.equal(new Set(rubric.conceptMappings.map((mapping) => mapping.conceptId)).size, graph.concepts.length);
  assert.deepEqual(
    [...rubric.conceptMappings].map((mapping) => mapping.conceptId).sort(),
    [...graph.concepts].map((concept) => concept.conceptId).sort(),
  );
  for (const stageId of requiredStages) {
    assert.ok(rubric.conceptMappings.some((mapping) => mapping.stage === stageId), `${stageId} is empty`);
  }
  for (const track of rubric.tracks) {
    const count = rubric.conceptMappings.filter((mapping) => mapping.tracks.includes(track.trackId)).length;
    assert.ok(count >= track.minimumMappedConcepts, `${track.trackId} has only ${count} concepts`);
  }
  assert.equal(validatePhdRubric(rubric, graph).ok, true);

  const unmapped = clone(rubric);
  unmapped.conceptMappings.pop();
  assert.match(validatePhdRubric(unmapped, graph).errors.join('\n'), /unmapped concept|mapping count/);
});

test('blueprint treats qualifying exams as unseen qualification and declares all core, specialization, proof, and research gates', () => {
  assert.equal(blueprint.unseenExamProtocol.qualificationNotReview, true);
  assert.equal(blueprint.coreExams.length, 4);
  assert.ok(blueprint.coreExams.some((exam) => exam.tracks.includes('abstract-algebra')));
  assert.ok(blueprint.coreExams.some((exam) => exam.tracks.includes('real-analysis')));
  assert.ok(blueprint.coreExams.some((exam) => (
    exam.tracks.includes('topology') && exam.tracks.includes('differential-geometry')
  )));
  assert.ok(blueprint.coreExams.some((exam) => (
    exam.tracks.includes('measure-probability-stochastic')
    && exam.tracks.includes('numerical-analysis-optimization')
  )));
  assert.equal(blueprint.formalProofGate.researchMainResultMustBindArtifactDigest, true);
  assert.equal(blueprint.researchGate.independentReproductionRequired, true);
  assert.equal(blueprint.researchGate.globalNoveltyInferenceForbidden, true);
  assert.equal(validatePhdBlueprint(blueprint, rubric, graph).ok, true);
  assert.equal(program.ok, true);
});

test('companion schemas expose strict product identities and static artifact floors', () => {
  assert.equal(trajectorySchema.$id, graph.schemaVersion);
  assert.equal(trajectorySchema.additionalProperties, false);
  assert.equal(trajectorySchema.properties.concepts.minItems, 256);
  assert.equal(rubricSchema.$id, rubric.schemaVersion);
  assert.equal(rubricSchema.additionalProperties, false);
  assert.equal(rubricSchema.properties.stages.minItems, 6);
  assert.equal(blueprintSchema.$id, blueprint.schemaVersion);
  assert.equal(blueprintSchema.additionalProperties, false);
  assert.equal(blueprintSchema.properties.coreExams.minItems, 4);
});

test('complete acquisition coverage alone is curriculum breadth and never PhD qualification', () => {
  const evidence = syntheticEvidence({
    includeQualifying: false,
    includeProofs: false,
    includeSpecialization: false,
    includeResearch: false,
  });
  const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
  assert.equal(report.evidenceIntegrity.ok, true);
  assert.equal(report.acquisition.allTrajectoryConceptsCovered, true);
  assert.equal(report.curriculumBreadth.satisfied, true);
  assert.equal(report.qualifyingPerformance.satisfied, false);
  assert.equal(report.phd_math_qualified, false);
});

test('qualifying, proof, and specialization passes still refuse the claim without research', () => {
  const evidence = syntheticEvidence({ includeResearch: false });
  const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
  assert.equal(report.evidenceIntegrity.ok, true);
  assert.equal(report.curriculumBreadth.satisfied, true);
  assert.equal(report.qualifyingPerformance.satisfied, true);
  assert.equal(report.formalProofEvidence.satisfied, true);
  assert.equal(report.specialization.satisfied, true);
  assert.equal(report.research.satisfied, false);
  assert.equal(report.phd_math_qualified, false);
});

test('novelty remains a scoped status and bounded-corpus evidence never becomes inferred global novelty', () => {
  const evidence = syntheticEvidence({ noveltyStatus: 'bounded_corpus_only' });
  const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
  assert.equal(report.evidenceIntegrity.ok, true);
  assert.equal(report.novelty.status, 'bounded_corpus_only');
  assert.equal(report.novelty.globalNoveltyInferred, false);
  assert.match(report.novelty.scopeStatement, /frozen declared corpus/);
  assert.equal(rubric.noveltyStatuses.every((status) => status.permitsGlobalNoveltyClaim === false), true);
});

test('fully synthetic artifact-derived evidence can exercise schema gates but never qualifies a live claim', () => {
  const evidence = syntheticEvidence();
  const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
  assert.deepEqual(report.evidenceIntegrity, { ok: true, errors: [] });
  assert.equal(report.acquisition.coveredConceptCount, graph.concepts.length);
  assert.equal(report.curriculumBreadth.coveredRequiredConceptCount,
    rubric.conceptMappings.filter((mapping) => mapping.requiredForQualification).length);
  assert.deepEqual(report.qualifyingPerformance.passedExamIds, blueprint.coreExams.map((exam) => exam.examId));
  assert.equal(report.formalProofEvidence.kernelCheckedObligationIds.length,
    rubric.formalProofObligations.length);
  assert.equal(report.specialization.satisfied, true);
  assert.equal(report.research.reproducible, true);
  assert.equal(report.research.formalProofGatePassed, true);
  assert.equal(report.stages.every((stage) => stage.satisfied), true);
  assert.equal(report.all_declared_schema_gates_satisfied, true);
  assert.equal(report.capabilities.phd_math_qualified, false);
  assert.equal(report.phd_math_qualified, false);
  assert.match(report.truthBoundary, /cannot establish a live claim/);
});

test('missing, duplicate, stale, malformed, and digest-mismatched evidence all fail closed', async (t) => {
  await t.test('missing evidence', () => {
    const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph });
    assert.equal(report.evidenceIntegrity.ok, false);
    assert.equal(report.phd_math_qualified, false);
    assert.match(report.evidenceIntegrity.errors.join('\n'), /evidence must be an object/);
  });

  await t.test('duplicate evidence', () => {
    const evidence = syntheticEvidence();
    evidence.acquisition.conceptEvidence[1].evidenceId = evidence.acquisition.conceptEvidence[0].evidenceId;
    const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
    assert.equal(report.evidenceIntegrity.ok, false);
    assert.equal(report.phd_math_qualified, false);
    assert.match(report.evidenceIntegrity.errors.join('\n'), /duplicate evidenceId/);
  });

  await t.test('stale evidence', () => {
    const evidence = syntheticEvidence();
    evidence.qualifying.examAttempts[0].completedAt = '2020-01-01T12:00:00.000Z';
    const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
    assert.equal(report.evidenceIntegrity.ok, false);
    assert.equal(report.phd_math_qualified, false);
    assert.match(report.evidenceIntegrity.errors.join('\n'), /stale|predates the rubric/);
  });

  await t.test('malformed evidence', () => {
    const evidence = syntheticEvidence();
    delete evidence.specialization.examAttempt.solutionDigest;
    const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
    assert.equal(report.evidenceIntegrity.ok, false);
    assert.equal(report.phd_math_qualified, false);
    assert.match(report.evidenceIntegrity.errors.join('\n'), /missing or unknown fields/);
  });

  await t.test('artifact digest mismatch', () => {
    const evidence = syntheticEvidence();
    evidence.programDigests.graph = digest('wrong-graph');
    const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
    assert.equal(report.evidenceIntegrity.ok, false);
    assert.equal(report.phd_math_qualified, false);
    assert.match(report.evidenceIntegrity.errors.join('\n'), /graph digest mismatch/);
  });

  await t.test('exam specification digest mismatch', () => {
    const evidence = syntheticEvidence();
    evidence.qualifying.examAttempts[0].examSpecDigest = digest('wrong-exam');
    const report = computePhdCapabilityReport({ graph, rubric, blueprint, legacyGraph, evidence });
    assert.equal(report.evidenceIntegrity.ok, false);
    assert.equal(report.phd_math_qualified, false);
    assert.match(report.evidenceIntegrity.errors.join('\n'), /exam specification digest mismatch/);
  });
});

test('canonical program digests bind the exact graph, rubric, and blueprint', () => {
  assert.equal(program.digests.graph, canonicalDigest(graph));
  assert.equal(program.digests.rubric, canonicalDigest(rubric));
  assert.equal(program.digests.blueprint, canonicalDigest(blueprint));
  assert.equal(new Set(Object.values(program.examSpecDigests)).size, blueprint.coreExams.length + 1);
  assert.equal(new Set(Object.values(program.proofObligationSpecDigests)).size,
    rubric.formalProofObligations.length);
});
