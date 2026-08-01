import crypto from 'node:crypto';

export const PHD_TRAJECTORY_SCHEMA = 'cortex.learning_os.phd_trajectory_graph.v1';
export const PHD_RUBRIC_SCHEMA = 'cortex.learning_os.phd_competency_rubric.v1';
export const PHD_BLUEPRINT_SCHEMA = 'cortex.learning_os.phd_qualifying_blueprint.v1';
export const PHD_EVIDENCE_SCHEMA = 'cortex.learning_os.phd_qualification_evidence.v1';
export const PHD_REPORT_SCHEMA = 'cortex.learning_os.phd_capability_report.v1';

const STAGES = [
  'proof_foundations',
  'undergraduate_core',
  'graduate_core',
  'qualifying',
  'specialization',
  'research',
];
const NOVELTY_STATUSES = ['unestablished', 'bounded_corpus_only', 'externally_established'];
const KERNELS = ['lean4', 'coq', 'isabelle'];
const DIGEST = /^[0-9a-f]{64}$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const DAY_MS = 86_400_000;

const GRAPH_KEYS = new Set([
  'schemaVersion', 'curriculumId', 'capsuleId', 'domain', 'version',
  'legacyPrefix', 'concepts', 'truthBoundary',
]);
const CONCEPT_KEYS = new Set(['conceptId', 'title', 'category', 'prerequisites', 'outcomes']);
const RUBRIC_KEYS = new Set([
  'schemaVersion', 'rubricId', 'version', 'effectiveAt', 'curriculum', 'qualifyingBlueprint',
  'stages', 'tracks', 'conceptMappings', 'formalProofObligations', 'noveltyStatuses',
  'evidenceFreshnessDays', 'qualificationClaim', 'truthBoundary',
]);
const BLUEPRINT_KEYS = new Set([
  'schemaVersion', 'blueprintId', 'version', 'curriculum', 'rubric', 'unseenExamProtocol',
  'coreExams', 'specializationExam', 'formalProofGate', 'researchGate', 'truthBoundary',
]);
const EXAM_KEYS = new Set([
  'examId', 'version', 'title', 'required', 'tracks', 'durationMinutes',
  'minimumProblemCount', 'passThreshold', 'evidenceRequirements',
]);
const SPECIALIZATION_EXAM_KEYS = new Set([
  'examId', 'version', 'title', 'eligibleTracks', 'minimumDeclaredTracks',
  'durationMinutes', 'minimumProblemCount', 'passThreshold', 'evidenceRequirements',
]);

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return record(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function uniqueStrings(values) {
  return Array.isArray(values)
    && values.every(nonEmpty)
    && new Set(values).size === values.length;
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function push(errors, condition, message) {
  if (!condition) errors.push(message);
}

function serializeCanonicalJson(value, active) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`canonical JSON rejects ${typeof value} values`);
  }
  if (active.has(value)) throw new TypeError('canonical JSON rejects cyclic values');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1
          || ownKeys.some((key) => (
            key !== 'length'
            && (typeof key !== 'string'
              || !/^(0|[1-9]\d*)$/.test(key)
              || Number(key) >= value.length)
          ))) {
        throw new TypeError('canonical JSON rejects sparse or extended arrays');
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('canonical JSON rejects sparse arrays');
        }
      }
      return `[${value.map((entry) => serializeCanonicalJson(entry, active)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonical JSON accepts only arrays and plain objects');
    }
    const ownKeys = Reflect.ownKeys(value);
    const keys = Object.keys(value);
    if (ownKeys.length !== keys.length
        || keys.some((key) => !Object.hasOwn(
          Object.getOwnPropertyDescriptor(value, key),
          'value',
        ))) {
      throw new TypeError('canonical JSON rejects symbols, accessors, or hidden fields');
    }
    return `{${keys.sort().map((key) => (
      `${JSON.stringify(key)}:${serializeCanonicalJson(value[key], active)}`
    )).join(',')}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalJson(value) {
  return serializeCanonicalJson(value, new Set());
}

export function canonicalDigest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function validateLegacyPrefix(graph, legacyGraph, errors) {
  const prefix = graph.legacyPrefix;
  const prefixKeys = new Set(['curriculumId', 'version', 'conceptCount', 'preservationRule']);
  push(errors, exactKeys(prefix, prefixKeys), 'graph legacyPrefix must contain only the declared fields');
  if (!record(prefix)) return;
  push(errors, prefix.curriculumId === legacyGraph?.curriculumId, 'legacy curriculumId mismatch');
  push(errors, prefix.version === legacyGraph?.version, 'legacy version mismatch');
  push(errors, prefix.conceptCount === legacyGraph?.concepts?.length, 'legacy concept count mismatch');
  push(errors, prefix.conceptCount === 84, 'legacy concept count must be exactly 84');
  push(errors, nonEmpty(prefix.preservationRule), 'legacy preservation rule is required');
  if (!Array.isArray(legacyGraph?.concepts)) {
    errors.push('legacy graph concepts are required for preservation validation');
    return;
  }
  if (!Array.isArray(graph.concepts) || graph.concepts.length < legacyGraph.concepts.length) return;
  for (let index = 0; index < legacyGraph.concepts.length; index += 1) {
    if (canonicalJson(graph.concepts[index]) !== canonicalJson(legacyGraph.concepts[index])) {
      errors.push(`legacy concept changed or moved at index ${index}`);
    }
  }
}

export function validatePhdTrajectory(graph, legacyGraph) {
  const errors = [];
  if (!record(graph)) return { ok: false, errors: ['graph must be an object'] };
  push(errors, exactKeys(graph, GRAPH_KEYS), 'graph contains missing or unknown top-level fields');
  push(errors, graph.schemaVersion === PHD_TRAJECTORY_SCHEMA, 'invalid trajectory schemaVersion');
  push(errors, graph.curriculumId === 'math-phd-trajectory-v1', 'invalid trajectory curriculumId');
  push(errors, nonEmpty(graph.capsuleId), 'graph capsuleId is required');
  push(errors, graph.domain === 'mathematics', 'graph domain must be mathematics');
  push(errors, nonEmpty(graph.version), 'graph version is required');
  push(errors, nonEmpty(graph.truthBoundary), 'graph truthBoundary is required');
  if (!Array.isArray(graph.concepts) || graph.concepts.length < 256 || graph.concepts.length > 1000) {
    errors.push('graph concepts must contain between 256 and 1000 records');
    return { ok: false, errors, conceptCount: Array.isArray(graph.concepts) ? graph.concepts.length : 0 };
  }

  validateLegacyPrefix(graph, legacyGraph, errors);
  const ids = new Set();
  const titleKeys = new Map();
  const outcomeKeys = new Map();
  for (let index = 0; index < graph.concepts.length; index += 1) {
    const concept = graph.concepts[index];
    if (!exactKeys(concept, CONCEPT_KEYS)) {
      errors.push(`concept at index ${index} contains missing or unknown fields`);
      continue;
    }
    push(errors, KEBAB.test(concept.conceptId), `invalid kebab-case conceptId at index ${index}`);
    push(errors, nonEmpty(concept.title), `missing concept title: ${concept.conceptId}`);
    push(errors, nonEmpty(concept.category), `missing concept category: ${concept.conceptId}`);
    push(errors, uniqueStrings(concept.prerequisites), `invalid prerequisites: ${concept.conceptId}`);
    push(errors, uniqueStrings(concept.outcomes) && concept.outcomes.length > 0,
      `invalid outcomes: ${concept.conceptId}`);
    if (ids.has(concept.conceptId)) errors.push(`duplicate conceptId: ${concept.conceptId}`);
    ids.add(concept.conceptId);

    const titleKey = normalizedText(concept.title);
    if (titleKeys.has(titleKey)) {
      errors.push(`duplicate normalized title: ${concept.title} / ${titleKeys.get(titleKey)}`);
    }
    titleKeys.set(titleKey, concept.title);
    for (const outcome of concept.outcomes) {
      const outcomeKey = normalizedText(outcome);
      if (outcomeKeys.has(outcomeKey)) {
        errors.push(`duplicate normalized outcome: ${outcome} / ${outcomeKeys.get(outcomeKey)}`);
      }
      outcomeKeys.set(outcomeKey, outcome);
    }
  }

  const positions = new Map(graph.concepts.map((concept, index) => [concept.conceptId, index]));
  for (let index = 0; index < graph.concepts.length; index += 1) {
    const concept = graph.concepts[index];
    if (!record(concept) || !Array.isArray(concept.prerequisites)) continue;
    for (const prerequisite of concept.prerequisites) {
      if (!positions.has(prerequisite)) {
        errors.push(`unknown prerequisite ${prerequisite} for ${concept.conceptId}`);
      } else if (positions.get(prerequisite) >= index) {
        errors.push(`prerequisite ${prerequisite} does not precede ${concept.conceptId}`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    conceptCount: graph.concepts.length,
    normalizedTitleCount: titleKeys.size,
    normalizedOutcomeCount: outcomeKeys.size,
  };
}

function validateStageDefinitions(rubric, errors) {
  if (!Array.isArray(rubric.stages)) {
    errors.push('rubric stages must be an array');
    return;
  }
  push(errors, rubric.stages.length === STAGES.length, 'rubric must declare exactly six stages');
  const seen = new Set();
  const stageKeys = new Set(['stageId', 'title', 'prerequisiteStages', 'evidenceRequirements']);
  for (let index = 0; index < rubric.stages.length; index += 1) {
    const stage = rubric.stages[index];
    push(errors, exactKeys(stage, stageKeys), `invalid stage record at index ${index}`);
    if (!record(stage)) continue;
    push(errors, stage.stageId === STAGES[index], `stage order mismatch at index ${index}`);
    push(errors, nonEmpty(stage.title), `stage title missing: ${stage.stageId}`);
    push(errors, uniqueStrings(stage.prerequisiteStages), `invalid stage prerequisites: ${stage.stageId}`);
    push(errors, record(stage.evidenceRequirements)
      && Object.keys(stage.evidenceRequirements).length >= 3
      && Object.values(stage.evidenceRequirements).every((value) => (
        nonEmpty(value) || (Number.isInteger(value) && value > 0)
      )),
    `stage evidence requirements must be measurable: ${stage.stageId}`);
    for (const prerequisite of stage.prerequisiteStages || []) {
      if (!seen.has(prerequisite)) errors.push(`stage prerequisite does not precede ${stage.stageId}: ${prerequisite}`);
    }
    seen.add(stage.stageId);
  }
  push(errors, [...seen].sort().join(',') === [...STAGES].sort().join(','), 'rubric stage identifiers mismatch');
}

function validateTrackDefinitions(rubric, errors) {
  if (!Array.isArray(rubric.tracks) || rubric.tracks.length < 15) {
    errors.push('rubric must declare at least 15 tracks');
    return new Set();
  }
  const trackKeys = new Set(['trackId', 'title', 'description', 'minimumMappedConcepts']);
  const ids = new Set();
  for (const track of rubric.tracks) {
    push(errors, exactKeys(track, trackKeys), `invalid track record: ${track?.trackId || '<missing>'}`);
    if (!record(track)) continue;
    push(errors, KEBAB.test(track.trackId), `invalid trackId: ${track.trackId}`);
    push(errors, nonEmpty(track.title) && nonEmpty(track.description), `invalid track text: ${track.trackId}`);
    push(errors, Number.isInteger(track.minimumMappedConcepts) && track.minimumMappedConcepts >= 1,
      `invalid minimumMappedConcepts: ${track.trackId}`);
    if (ids.has(track.trackId)) errors.push(`duplicate trackId: ${track.trackId}`);
    ids.add(track.trackId);
  }
  return ids;
}

function validateMappings(rubric, graph, trackIds, errors) {
  if (!Array.isArray(rubric.conceptMappings)) {
    errors.push('rubric conceptMappings must be an array');
    return;
  }
  const mappingKeys = new Set(['conceptId', 'stage', 'tracks', 'requiredForQualification']);
  const graphIds = new Set(graph.concepts.map((concept) => concept.conceptId));
  const mapped = new Set();
  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
  const trackCounts = Object.fromEntries([...trackIds].map((trackId) => [trackId, 0]));
  for (const mapping of rubric.conceptMappings) {
    push(errors, exactKeys(mapping, mappingKeys), `invalid concept mapping: ${mapping?.conceptId || '<missing>'}`);
    if (!record(mapping)) continue;
    push(errors, graphIds.has(mapping.conceptId), `mapping references unknown concept: ${mapping.conceptId}`);
    push(errors, STAGES.includes(mapping.stage), `mapping has unknown stage: ${mapping.conceptId}`);
    push(errors, uniqueStrings(mapping.tracks) && mapping.tracks.length > 0,
      `mapping must include at least one unique track: ${mapping.conceptId}`);
    push(errors, typeof mapping.requiredForQualification === 'boolean',
      `mapping qualification flag must be boolean: ${mapping.conceptId}`);
    if (mapped.has(mapping.conceptId)) errors.push(`duplicate concept mapping: ${mapping.conceptId}`);
    mapped.add(mapping.conceptId);
    if (STAGES.includes(mapping.stage)) stageCounts[mapping.stage] += 1;
    for (const trackId of mapping.tracks || []) {
      if (!trackIds.has(trackId)) errors.push(`mapping references unknown track ${trackId}: ${mapping.conceptId}`);
      else trackCounts[trackId] += 1;
    }
    const shouldBeRequired = ['proof_foundations', 'undergraduate_core', 'graduate_core'].includes(mapping.stage);
    if (mapping.requiredForQualification !== shouldBeRequired) {
      errors.push(`requiredForQualification must follow stage policy: ${mapping.conceptId}`);
    }
  }
  for (const conceptId of graphIds) {
    if (!mapped.has(conceptId)) errors.push(`unmapped concept: ${conceptId}`);
  }
  push(errors, mapped.size === graphIds.size, 'mapping count must equal graph concept count');
  for (const stage of STAGES) push(errors, stageCounts[stage] > 0, `stage has no mapped concepts: ${stage}`);
  for (const track of rubric.tracks) {
    push(errors, trackCounts[track.trackId] >= track.minimumMappedConcepts,
      `track breadth below declared minimum: ${track.trackId}`);
  }
}

function validateProofObligations(rubric, errors) {
  const obligationKeys = new Set([
    'obligationId', 'title', 'stage', 'statement', 'acceptedKernels',
    'requiredForQualification', 'researchArtifactBound',
  ]);
  if (!Array.isArray(rubric.formalProofObligations) || rubric.formalProofObligations.length < 1) {
    errors.push('rubric formalProofObligations must be nonempty');
    return;
  }
  const ids = new Set();
  let researchBound = 0;
  for (const obligation of rubric.formalProofObligations) {
    push(errors, exactKeys(obligation, obligationKeys),
      `invalid formal proof obligation: ${obligation?.obligationId || '<missing>'}`);
    if (!record(obligation)) continue;
    push(errors, IDENTIFIER.test(obligation.obligationId), `invalid proof obligationId: ${obligation.obligationId}`);
    push(errors, nonEmpty(obligation.title) && typeof obligation.statement === 'string'
      && obligation.statement.trim().length >= 20, `invalid proof obligation text: ${obligation.obligationId}`);
    push(errors, STAGES.includes(obligation.stage), `invalid proof obligation stage: ${obligation.obligationId}`);
    push(errors, uniqueStrings(obligation.acceptedKernels)
      && obligation.acceptedKernels.every((kernel) => KERNELS.includes(kernel)),
    `invalid accepted kernels: ${obligation.obligationId}`);
    push(errors, obligation.requiredForQualification === true,
      `all declared proof obligations must be required: ${obligation.obligationId}`);
    push(errors, typeof obligation.researchArtifactBound === 'boolean',
      `invalid researchArtifactBound: ${obligation.obligationId}`);
    if (obligation.researchArtifactBound) {
      researchBound += 1;
      push(errors, obligation.stage === 'research', 'research-bound proof must be in research stage');
    }
    if (ids.has(obligation.obligationId)) errors.push(`duplicate proof obligationId: ${obligation.obligationId}`);
    ids.add(obligation.obligationId);
  }
  push(errors, researchBound >= 1, 'at least one research-artifact-bound proof is required');
}

function validateNoveltyAndClaim(rubric, errors) {
  const noveltyKeys = new Set(['status', 'meaning', 'permitsGlobalNoveltyClaim']);
  push(errors, Array.isArray(rubric.noveltyStatuses) && rubric.noveltyStatuses.length === NOVELTY_STATUSES.length,
    'rubric must declare exactly three novelty statuses');
  const statuses = new Set();
  for (const novelty of rubric.noveltyStatuses || []) {
    push(errors, exactKeys(novelty, noveltyKeys), `invalid novelty status: ${novelty?.status || '<missing>'}`);
    if (!record(novelty)) continue;
    push(errors, NOVELTY_STATUSES.includes(novelty.status), `unknown novelty status: ${novelty.status}`);
    push(errors, nonEmpty(novelty.meaning), `novelty meaning missing: ${novelty.status}`);
    push(errors, novelty.permitsGlobalNoveltyClaim === false,
      `novelty status must not permit inferred global novelty: ${novelty.status}`);
    if (statuses.has(novelty.status)) errors.push(`duplicate novelty status: ${novelty.status}`);
    statuses.add(novelty.status);
  }
  push(errors, NOVELTY_STATUSES.every((status) => statuses.has(status)), 'novelty statuses are incomplete');

  const freshnessKeys = [
    'conceptCoverage', 'qualifyingExam', 'formalProof', 'specializationExam', 'researchArtifact',
  ];
  push(errors, record(rubric.evidenceFreshnessDays)
    && Object.keys(rubric.evidenceFreshnessDays).sort().join(',') === freshnessKeys.sort().join(',')
    && Object.values(rubric.evidenceFreshnessDays).every((days) => Number.isInteger(days) && days > 0),
  'invalid evidence freshness policy');

  const claim = rubric.qualificationClaim;
  const claimKeys = new Set([
    'claimId', 'requiredConceptStages', 'conceptCoveragePolicy', 'requiredCoreExamPolicy',
    'formalProofPolicy', 'specializationPolicy', 'researchPolicy', 'noveltyPolicy',
    'courseCoverageAloneCanSatisfy',
  ]);
  push(errors, exactKeys(claim, claimKeys), 'qualification claim contains missing or unknown fields');
  if (!record(claim)) return;
  push(errors, claim.claimId === 'phd_math_qualified', 'invalid qualification claimId');
  push(errors, canonicalJson(claim.requiredConceptStages)
    === canonicalJson(['proof_foundations', 'undergraduate_core', 'graduate_core']),
  'qualification concept stages must include proof, undergraduate, and graduate core');
  push(errors, claim.conceptCoveragePolicy === 'all_required_concepts', 'claim must require all concepts');
  push(errors, claim.requiredCoreExamPolicy === 'all_required_unseen_core_exams_pass',
    'claim must require all unseen core exams');
  push(errors, claim.formalProofPolicy === 'all_required_obligations_kernel_checked',
    'claim must require all kernel-checked proof obligations');
  push(errors, claim.specializationPolicy === 'one_unseen_specialization_exam_pass',
    'claim must require a specialization exam');
  push(errors, claim.researchPolicy === 'bounded_artifact_independently_reproduced_and_main_result_kernel_checked',
    'claim must require a reproducible formally checked research artifact');
  push(errors, claim.noveltyPolicy === 'record_separately_never_infer_global_novelty',
    'claim must separate novelty');
  push(errors, claim.courseCoverageAloneCanSatisfy === false,
    'course or acquisition coverage must never satisfy the qualification claim alone');
}

export function validatePhdRubric(rubric, graph) {
  const errors = [];
  if (!record(rubric)) return { ok: false, errors: ['rubric must be an object'] };
  if (!record(graph) || !Array.isArray(graph.concepts)) return { ok: false, errors: ['valid graph is required'] };
  push(errors, exactKeys(rubric, RUBRIC_KEYS), 'rubric contains missing or unknown top-level fields');
  push(errors, rubric.schemaVersion === PHD_RUBRIC_SCHEMA, 'invalid rubric schemaVersion');
  push(errors, rubric.rubricId === 'math-phd-competency-v1', 'invalid rubricId');
  push(errors, nonEmpty(rubric.version), 'rubric version is required');
  push(errors, Number.isFinite(Date.parse(rubric.effectiveAt)), 'rubric effectiveAt must be a timestamp');
  push(errors, rubric.curriculum?.curriculumId === graph.curriculumId
    && rubric.curriculum?.version === graph.version
    && Object.keys(rubric.curriculum || {}).length === 2,
  'rubric curriculum reference mismatch');
  push(errors, rubric.qualifyingBlueprint?.blueprintId === 'math-phd-qualifying-v1'
    && nonEmpty(rubric.qualifyingBlueprint?.version)
    && Object.keys(rubric.qualifyingBlueprint || {}).length === 2,
  'rubric qualifying blueprint reference is invalid');
  push(errors, nonEmpty(rubric.truthBoundary), 'rubric truthBoundary is required');
  validateStageDefinitions(rubric, errors);
  const trackIds = validateTrackDefinitions(rubric, errors);
  validateMappings(rubric, graph, trackIds, errors);
  validateProofObligations(rubric, errors);
  validateNoveltyAndClaim(rubric, errors);
  return {
    ok: errors.length === 0,
    errors,
    stageCount: Array.isArray(rubric.stages) ? rubric.stages.length : 0,
    trackCount: trackIds.size,
    mappingCount: Array.isArray(rubric.conceptMappings) ? rubric.conceptMappings.length : 0,
  };
}

function validateExam(exam, trackIds, errors) {
  push(errors, exactKeys(exam, EXAM_KEYS), `invalid core exam record: ${exam?.examId || '<missing>'}`);
  if (!record(exam)) return;
  push(errors, IDENTIFIER.test(exam.examId), `invalid core examId: ${exam.examId}`);
  push(errors, nonEmpty(exam.version) && nonEmpty(exam.title), `invalid core exam text: ${exam.examId}`);
  push(errors, exam.required === true, `core exam must be required: ${exam.examId}`);
  push(errors, uniqueStrings(exam.tracks) && exam.tracks.length > 0
    && exam.tracks.every((track) => trackIds.has(track)), `invalid core exam tracks: ${exam.examId}`);
  push(errors, Number.isInteger(exam.durationMinutes) && exam.durationMinutes >= 60,
    `invalid core exam duration: ${exam.examId}`);
  push(errors, Number.isInteger(exam.minimumProblemCount) && exam.minimumProblemCount >= 1,
    `invalid core exam problem count: ${exam.examId}`);
  push(errors, boundedScore(exam.passThreshold) && exam.passThreshold > 0,
    `invalid core exam threshold: ${exam.examId}`);
  const requiredEvidence = [
    'sealed_prompt_commitment', 'independent_proctor', 'scored_solution_digest',
    'no_prior_access_attestation',
  ];
  push(errors, uniqueStrings(exam.evidenceRequirements)
    && requiredEvidence.every((item) => exam.evidenceRequirements.includes(item)),
  `core exam evidence requirements incomplete: ${exam.examId}`);
}

export function validatePhdBlueprint(blueprint, rubric, graph) {
  const errors = [];
  if (!record(blueprint)) return { ok: false, errors: ['blueprint must be an object'] };
  if (!record(rubric) || !record(graph)) return { ok: false, errors: ['rubric and graph are required'] };
  push(errors, exactKeys(blueprint, BLUEPRINT_KEYS), 'blueprint contains missing or unknown top-level fields');
  push(errors, blueprint.schemaVersion === PHD_BLUEPRINT_SCHEMA, 'invalid blueprint schemaVersion');
  push(errors, blueprint.blueprintId === rubric.qualifyingBlueprint?.blueprintId, 'blueprintId reference mismatch');
  push(errors, blueprint.version === rubric.qualifyingBlueprint?.version, 'blueprint version reference mismatch');
  push(errors, blueprint.curriculum?.curriculumId === graph.curriculumId
    && blueprint.curriculum?.version === graph.version
    && Object.keys(blueprint.curriculum || {}).length === 2,
  'blueprint curriculum reference mismatch');
  push(errors, blueprint.rubric?.rubricId === rubric.rubricId
    && blueprint.rubric?.version === rubric.version
    && Object.keys(blueprint.rubric || {}).length === 2,
  'blueprint rubric reference mismatch');
  push(errors, nonEmpty(blueprint.truthBoundary), 'blueprint truthBoundary is required');

  const protocolKeys = [
    'itemBankSealedBeforeAttempt', 'candidateNoPriorAccessAttested', 'promptCommitmentRequired',
    'independentProctorRequired', 'uniqueAttemptRequired', 'qualificationNotReview',
  ];
  push(errors, record(blueprint.unseenExamProtocol)
    && Object.keys(blueprint.unseenExamProtocol).sort().join(',') === protocolKeys.sort().join(',')
    && Object.values(blueprint.unseenExamProtocol).every((value) => value === true),
  'unseen exam protocol must enable every fail-closed qualification control');

  const trackIds = new Set(rubric.tracks.map((track) => track.trackId));
  push(errors, Array.isArray(blueprint.coreExams) && blueprint.coreExams.length >= 4,
    'blueprint must declare at least four core exams');
  const examIds = new Set();
  for (const exam of blueprint.coreExams || []) {
    validateExam(exam, trackIds, errors);
    if (examIds.has(exam.examId)) errors.push(`duplicate core examId: ${exam.examId}`);
    examIds.add(exam.examId);
  }
  const breadthFamilies = [
    ['abstract-algebra', 'advanced-linear-algebra'],
    ['real-analysis', 'functional-analysis'],
    ['topology', 'differential-geometry'],
    ['measure-probability-stochastic', 'numerical-analysis-optimization'],
  ];
  for (const family of breadthFamilies) {
    push(errors, (blueprint.coreExams || []).some((exam) => family.every((track) => exam.tracks?.includes(track))),
      `core exam family missing: ${family.join('+')}`);
  }

  const specialization = blueprint.specializationExam;
  push(errors, exactKeys(specialization, SPECIALIZATION_EXAM_KEYS), 'invalid specialization exam record');
  if (record(specialization)) {
    push(errors, IDENTIFIER.test(specialization.examId) && nonEmpty(specialization.version)
      && nonEmpty(specialization.title), 'invalid specialization exam identity');
    push(errors, uniqueStrings(specialization.eligibleTracks)
      && specialization.eligibleTracks.length > 0
      && specialization.eligibleTracks.every((track) => trackIds.has(track)),
    'invalid specialization eligible tracks');
    push(errors, Number.isInteger(specialization.minimumDeclaredTracks)
      && specialization.minimumDeclaredTracks >= 1, 'invalid specialization minimumDeclaredTracks');
    push(errors, Number.isInteger(specialization.durationMinutes) && specialization.durationMinutes >= 60,
      'invalid specialization duration');
    push(errors, Number.isInteger(specialization.minimumProblemCount)
      && specialization.minimumProblemCount >= 1, 'invalid specialization problem count');
    push(errors, boundedScore(specialization.passThreshold) && specialization.passThreshold > 0,
      'invalid specialization threshold');
    const specializationEvidence = [
      'sealed_prompt_commitment', 'independent_proctor', 'specialization_track_declaration',
      'scored_solution_digest', 'no_prior_access_attestation',
    ];
    push(errors, uniqueStrings(specialization.evidenceRequirements)
      && specializationEvidence.every((item) => specialization.evidenceRequirements.includes(item)),
    'specialization evidence requirements incomplete');
  }

  const formalKeys = [
    'requiredObligationPolicy', 'acceptedKernels', 'kernelOutputDigestRequired',
    'proofArtifactDigestRequired', 'researchMainResultMustBindArtifactDigest',
  ];
  push(errors, record(blueprint.formalProofGate)
    && Object.keys(blueprint.formalProofGate).sort().join(',') === formalKeys.sort().join(',')
    && blueprint.formalProofGate.requiredObligationPolicy === 'all_rubric_required_obligations'
    && canonicalJson(blueprint.formalProofGate.acceptedKernels) === canonicalJson(KERNELS)
    && blueprint.formalProofGate.kernelOutputDigestRequired === true
    && blueprint.formalProofGate.proofArtifactDigestRequired === true
    && blueprint.formalProofGate.researchMainResultMustBindArtifactDigest === true,
  'formal proof gate is incomplete');

  const researchKeys = [
    'gateId', 'boundedArtifactRequired', 'independentReproductionRequired',
    'independentReviewRequired', 'frozenEnvironmentDigestRequired', 'frozenCorpusDigestRequired',
    'researchMainResultFormalProofRequired', 'acceptedNoveltyStatuses',
    'globalNoveltyInferenceForbidden',
  ];
  push(errors, record(blueprint.researchGate)
    && Object.keys(blueprint.researchGate).sort().join(',') === researchKeys.sort().join(',')
    && IDENTIFIER.test(blueprint.researchGate.gateId)
    && blueprint.researchGate.boundedArtifactRequired === true
    && blueprint.researchGate.independentReproductionRequired === true
    && blueprint.researchGate.independentReviewRequired === true
    && blueprint.researchGate.frozenEnvironmentDigestRequired === true
    && blueprint.researchGate.frozenCorpusDigestRequired === true
    && blueprint.researchGate.researchMainResultFormalProofRequired === true
    && canonicalJson(blueprint.researchGate.acceptedNoveltyStatuses) === canonicalJson(NOVELTY_STATUSES)
    && blueprint.researchGate.globalNoveltyInferenceForbidden === true,
  'research gate is incomplete or permits global novelty inference');
  return {
    ok: errors.length === 0,
    errors,
    coreExamCount: Array.isArray(blueprint.coreExams) ? blueprint.coreExams.length : 0,
  };
}

export function validatePhdProgram({ graph, rubric, blueprint, legacyGraph } = {}) {
  const trajectory = validatePhdTrajectory(graph, legacyGraph);
  const competencyRubric = validatePhdRubric(rubric, graph);
  const qualifyingBlueprint = validatePhdBlueprint(blueprint, rubric, graph);
  const errors = [
    ...trajectory.errors.map((error) => `graph: ${error}`),
    ...competencyRubric.errors.map((error) => `rubric: ${error}`),
    ...qualifyingBlueprint.errors.map((error) => `blueprint: ${error}`),
  ];
  const digests = record(graph) && record(rubric) && record(blueprint) ? {
    graph: canonicalDigest(graph),
    rubric: canonicalDigest(rubric),
    blueprint: canonicalDigest(blueprint),
  } : {};
  const examSpecDigests = Object.fromEntries([
    ...(blueprint?.coreExams || []).map((exam) => [exam.examId, canonicalDigest(exam)]),
    ...(record(blueprint?.specializationExam)
      ? [[blueprint.specializationExam.examId, canonicalDigest(blueprint.specializationExam)]]
      : []),
  ]);
  const proofObligationSpecDigests = Object.fromEntries(
    (rubric?.formalProofObligations || []).map((obligation) => [
      obligation.obligationId,
      canonicalDigest(obligation),
    ]),
  );
  return {
    ok: errors.length === 0,
    errors,
    digests,
    examSpecDigests,
    proofObligationSpecDigests,
    trajectory,
    rubric: competencyRubric,
    blueprint: qualifyingBlueprint,
  };
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateFreshTimestamp(value, label, maximumDays, evaluatedAtMs, effectiveAtMs, errors) {
  if (!validTimestamp(value)) {
    errors.push(`${label} must be a valid timestamp`);
    return;
  }
  const timestamp = Date.parse(value);
  if (timestamp > evaluatedAtMs) errors.push(`${label} is in the future`);
  if (timestamp < effectiveAtMs) errors.push(`${label} predates the rubric`);
  if (evaluatedAtMs - timestamp > maximumDays * DAY_MS) errors.push(`${label} is stale`);
}

function validateDigest(value, label, errors) {
  push(errors, DIGEST.test(String(value || '')), `${label} must be a sha256 digest`);
}

function validateEvidenceId(value, label, ids, errors) {
  if (!IDENTIFIER.test(String(value || ''))) {
    errors.push(`${label} has an invalid evidenceId`);
    return;
  }
  if (ids.has(value)) errors.push(`duplicate evidenceId: ${value}`);
  ids.add(value);
}

function validateSubject(value, subjectId, label, errors) {
  push(errors, value === subjectId, `${label} subjectId mismatch`);
}

function validateUnseenProtocol(protocol, label, startedAt, errors) {
  const keys = new Set([
    'itemBankSealed', 'candidateNoPriorAccess', 'promptCommitmentDigest',
    'commitmentRecordedAt', 'promptReleasedAt', 'independentProctor',
  ]);
  if (!exactKeys(protocol, keys)) {
    errors.push(`${label} unseen protocol contains missing or unknown fields`);
    return;
  }
  push(errors, protocol.itemBankSealed === true, `${label} item bank was not sealed`);
  push(errors, protocol.candidateNoPriorAccess === true, `${label} prior access was not ruled out`);
  push(errors, protocol.independentProctor === true, `${label} lacks independent proctor evidence`);
  validateDigest(protocol.promptCommitmentDigest, `${label} prompt commitment`, errors);
  if (!validTimestamp(protocol.commitmentRecordedAt) || !validTimestamp(protocol.promptReleasedAt)
    || !validTimestamp(startedAt)) {
    errors.push(`${label} unseen protocol timestamps are invalid`);
    return;
  }
  push(errors, Date.parse(protocol.commitmentRecordedAt) < Date.parse(protocol.promptReleasedAt),
    `${label} prompt was not committed before release`);
  push(errors, Date.parse(protocol.promptReleasedAt) <= Date.parse(startedAt),
    `${label} prompt release occurred after the attempt began`);
}

function validateExamAttempt({
  attempt,
  spec,
  specDigest,
  subjectId,
  label,
  maximumDays,
  evaluatedAtMs,
  effectiveAtMs,
  ids,
  errors,
}) {
  const keys = new Set([
    'evidenceId', 'subjectId', 'examId', 'examVersion', 'examSpecDigest', 'score',
    'passed', 'startedAt', 'completedAt', 'solutionDigest', 'proctorId', 'unseenProtocol',
  ]);
  if (!exactKeys(attempt, keys)) {
    errors.push(`${label} attempt contains missing or unknown fields`);
    return false;
  }
  validateEvidenceId(attempt.evidenceId, label, ids, errors);
  validateSubject(attempt.subjectId, subjectId, label, errors);
  push(errors, attempt.examId === spec.examId, `${label} examId mismatch`);
  push(errors, attempt.examVersion === spec.version, `${label} examVersion mismatch`);
  validateDigest(attempt.examSpecDigest, `${label} examSpecDigest`, errors);
  push(errors, attempt.examSpecDigest === specDigest, `${label} exam specification digest mismatch`);
  push(errors, boundedScore(attempt.score), `${label} score is invalid`);
  push(errors, typeof attempt.passed === 'boolean', `${label} passed must be boolean`);
  if (boundedScore(attempt.score) && typeof attempt.passed === 'boolean') {
    push(errors, attempt.passed === (attempt.score >= spec.passThreshold),
      `${label} passed flag contradicts the declared threshold`);
  }
  validateFreshTimestamp(attempt.completedAt, `${label} completedAt`, maximumDays,
    evaluatedAtMs, effectiveAtMs, errors);
  push(errors, validTimestamp(attempt.startedAt)
    && validTimestamp(attempt.completedAt)
    && Date.parse(attempt.startedAt) < Date.parse(attempt.completedAt),
  `${label} attempt interval is invalid`);
  validateDigest(attempt.solutionDigest, `${label} solutionDigest`, errors);
  push(errors, nonEmpty(attempt.proctorId), `${label} proctorId is required`);
  validateUnseenProtocol(attempt.unseenProtocol, label, attempt.startedAt, errors);
  return attempt.passed === true && boundedScore(attempt.score) && attempt.score >= spec.passThreshold;
}

function blankReport(program, evidence, errors) {
  return {
    schemaVersion: PHD_REPORT_SCHEMA,
    subjectId: nonEmpty(evidence?.subjectId) ? evidence.subjectId : null,
    evaluatedAt: validTimestamp(evidence?.evaluatedAt) ? evidence.evaluatedAt : null,
    evidenceIntegrity: { ok: false, errors: sortedUnique(errors) },
    program: { valid: program.ok, digests: program.digests, errors: program.errors },
    acquisition: {
      coveredConceptCount: 0,
      submittedConceptCount: 0,
      allTrajectoryConceptsCovered: false,
    },
    curriculumBreadth: {
      requiredConceptCount: 0,
      coveredRequiredConceptCount: 0,
      missingRequiredConceptIds: [],
      byStage: [],
      satisfied: false,
    },
    qualifyingPerformance: {
      requiredExamIds: [],
      passedExamIds: [],
      missingOrFailedExamIds: [],
      satisfied: false,
    },
    formalProofEvidence: {
      requiredObligationIds: [],
      kernelCheckedObligationIds: [],
      missingOrFailedObligationIds: [],
      satisfied: false,
    },
    specialization: { declaredTracks: [], passed: false, satisfied: false },
    research: { artifactId: null, reproducible: false, formalProofGatePassed: false, satisfied: false },
    novelty: {
      status: 'unestablished',
      scopeStatement: 'No valid research novelty evidence was supplied.',
      globalNoveltyInferred: false,
    },
    stages: STAGES.map((stageId) => ({ stageId, satisfied: false })),
    capabilities: {
      acquisition_coverage_recorded: false,
      curriculum_breadth_satisfied: false,
      qualifying_exams_passed: false,
      formal_proofs_kernel_checked: false,
      specialization_exam_passed: false,
      bounded_research_gate_passed: false,
      phd_math_qualified: false,
    },
    phd_math_qualified: false,
    truthBoundary: 'No stage or capability claim may pass when program or evidence integrity fails.',
  };
}

export function computePhdCapabilityReport({
  graph,
  rubric,
  blueprint,
  legacyGraph,
  evidence,
} = {}) {
  const program = validatePhdProgram({ graph, rubric, blueprint, legacyGraph });
  const errors = [...program.errors.map((error) => `program ${error}`)];
  if (!record(evidence)) return blankReport(program, evidence, [...errors, 'evidence must be an object']);
  const evidenceKeys = new Set([
    'schemaVersion', 'subjectId', 'evaluatedAt', 'programDigests', 'acquisition',
    'qualifying', 'formalProofs', 'specialization', 'research',
  ]);
  push(errors, exactKeys(evidence, evidenceKeys), 'evidence contains missing or unknown top-level fields');
  push(errors, evidence.schemaVersion === PHD_EVIDENCE_SCHEMA, 'invalid evidence schemaVersion');
  push(errors, IDENTIFIER.test(String(evidence.subjectId || '')), 'invalid evidence subjectId');
  push(errors, validTimestamp(evidence.evaluatedAt), 'invalid evidence evaluatedAt');
  if (!program.ok || !validTimestamp(evidence.evaluatedAt) || !IDENTIFIER.test(String(evidence.subjectId || ''))) {
    return blankReport(program, evidence, errors);
  }
  const evaluatedAtMs = Date.parse(evidence.evaluatedAt);
  const effectiveAtMs = Date.parse(rubric.effectiveAt);
  push(errors, evaluatedAtMs >= effectiveAtMs, 'evaluation predates the rubric');
  const digestKeys = new Set(['graph', 'rubric', 'blueprint']);
  push(errors, exactKeys(evidence.programDigests, digestKeys), 'evidence programDigests are incomplete');
  for (const key of digestKeys) {
    validateDigest(evidence.programDigests?.[key], `programDigests.${key}`, errors);
    push(errors, evidence.programDigests?.[key] === program.digests[key], `${key} digest mismatch`);
  }

  const ids = new Set();
  const conceptEvidenceKeys = new Set([
    'evidenceId', 'subjectId', 'conceptId', 'status', 'assessedAt',
    'assessmentDigest', 'independentAssessmentCount',
  ]);
  const graphIds = new Set(graph.concepts.map((concept) => concept.conceptId));
  const conceptStatuses = new Map();
  if (!exactKeys(evidence.acquisition, new Set(['conceptEvidence']))
    || !Array.isArray(evidence.acquisition?.conceptEvidence)) {
    errors.push('acquisition conceptEvidence must be an array');
  } else {
    for (const item of evidence.acquisition.conceptEvidence) {
      if (!exactKeys(item, conceptEvidenceKeys)) {
        errors.push(`invalid concept evidence: ${item?.conceptId || '<missing>'}`);
        continue;
      }
      validateEvidenceId(item.evidenceId, `concept ${item.conceptId}`, ids, errors);
      validateSubject(item.subjectId, evidence.subjectId, `concept ${item.conceptId}`, errors);
      push(errors, graphIds.has(item.conceptId), `unknown evidence conceptId: ${item.conceptId}`);
      push(errors, ['covered', 'not_covered'].includes(item.status), `invalid concept status: ${item.conceptId}`);
      validateFreshTimestamp(item.assessedAt, `concept ${item.conceptId} assessedAt`,
        rubric.evidenceFreshnessDays.conceptCoverage, evaluatedAtMs, effectiveAtMs, errors);
      validateDigest(item.assessmentDigest, `concept ${item.conceptId} assessmentDigest`, errors);
      push(errors, Number.isInteger(item.independentAssessmentCount)
        && item.independentAssessmentCount >= 1, `invalid independent assessment count: ${item.conceptId}`);
      if (conceptStatuses.has(item.conceptId)) errors.push(`duplicate concept evidence: ${item.conceptId}`);
      conceptStatuses.set(item.conceptId, item.status);
    }
  }

  const requiredMappings = rubric.conceptMappings.filter((mapping) => mapping.requiredForQualification);
  const requiredIds = requiredMappings.map((mapping) => mapping.conceptId);
  const missingRequired = requiredIds.filter((conceptId) => conceptStatuses.get(conceptId) !== 'covered');
  const coveredConceptCount = [...conceptStatuses.values()].filter((status) => status === 'covered').length;
  const stageBreadth = STAGES.map((stageId) => {
    const mappings = rubric.conceptMappings.filter((mapping) => mapping.stage === stageId);
    const required = mappings.filter((mapping) => mapping.requiredForQualification);
    const covered = mappings.filter((mapping) => conceptStatuses.get(mapping.conceptId) === 'covered');
    return {
      stageId,
      mappedConceptCount: mappings.length,
      requiredConceptCount: required.length,
      coveredConceptCount: covered.length,
      requiredCoverageSatisfied: required.every((mapping) => conceptStatuses.get(mapping.conceptId) === 'covered'),
    };
  });
  const breadthSatisfied = missingRequired.length === 0;

  const qualifyingKeys = new Set(['examAttempts']);
  const examAttempts = new Map();
  if (!exactKeys(evidence.qualifying, qualifyingKeys) || !Array.isArray(evidence.qualifying?.examAttempts)) {
    errors.push('qualifying examAttempts must be an array');
  } else {
    const specs = new Map(blueprint.coreExams.map((exam) => [exam.examId, exam]));
    for (const attempt of evidence.qualifying.examAttempts) {
      if (examAttempts.has(attempt?.examId)) errors.push(`duplicate qualifying exam attempt: ${attempt?.examId}`);
      const spec = specs.get(attempt?.examId);
      if (!spec) {
        errors.push(`unknown qualifying examId: ${attempt?.examId || '<missing>'}`);
        continue;
      }
      const passed = validateExamAttempt({
        attempt,
        spec,
        specDigest: program.examSpecDigests[spec.examId],
        subjectId: evidence.subjectId,
        label: `qualifying exam ${spec.examId}`,
        maximumDays: rubric.evidenceFreshnessDays.qualifyingExam,
        evaluatedAtMs,
        effectiveAtMs,
        ids,
        errors,
      });
      examAttempts.set(spec.examId, passed);
    }
  }
  const requiredExamIds = blueprint.coreExams.filter((exam) => exam.required).map((exam) => exam.examId);
  const passedExamIds = requiredExamIds.filter((examId) => examAttempts.get(examId) === true);
  const missingOrFailedExamIds = requiredExamIds.filter((examId) => examAttempts.get(examId) !== true);
  const qualifyingSatisfied = missingOrFailedExamIds.length === 0;

  const proofKeys = new Set([
    'evidenceId', 'subjectId', 'obligationId', 'obligationSpecDigest', 'kernel',
    'kernelVersion', 'proofArtifactDigest', 'kernelOutputDigest', 'checkedAt', 'status',
    'researchArtifactDigest',
  ]);
  const proofStatuses = new Map();
  const proofEvidenceById = new Map();
  if (!Array.isArray(evidence.formalProofs)) {
    errors.push('formalProofs must be an array');
  } else {
    const obligations = new Map(rubric.formalProofObligations.map((item) => [item.obligationId, item]));
    for (const proof of evidence.formalProofs) {
      if (!exactKeys(proof, proofKeys)) {
        errors.push(`invalid formal proof evidence: ${proof?.obligationId || '<missing>'}`);
        continue;
      }
      validateEvidenceId(proof.evidenceId, `proof ${proof.obligationId}`, ids, errors);
      validateSubject(proof.subjectId, evidence.subjectId, `proof ${proof.obligationId}`, errors);
      const obligation = obligations.get(proof.obligationId);
      push(errors, Boolean(obligation), `unknown proof obligationId: ${proof.obligationId}`);
      if (!obligation) continue;
      if (proofStatuses.has(proof.obligationId)) errors.push(`duplicate proof evidence: ${proof.obligationId}`);
      validateDigest(proof.obligationSpecDigest, `proof ${proof.obligationId} obligationSpecDigest`, errors);
      push(errors, proof.obligationSpecDigest === program.proofObligationSpecDigests[proof.obligationId],
        `proof obligation digest mismatch: ${proof.obligationId}`);
      push(errors, obligation.acceptedKernels.includes(proof.kernel), `unaccepted proof kernel: ${proof.obligationId}`);
      push(errors, nonEmpty(proof.kernelVersion), `proof kernelVersion missing: ${proof.obligationId}`);
      validateDigest(proof.proofArtifactDigest, `proof ${proof.obligationId} proofArtifactDigest`, errors);
      validateDigest(proof.kernelOutputDigest, `proof ${proof.obligationId} kernelOutputDigest`, errors);
      validateFreshTimestamp(proof.checkedAt, `proof ${proof.obligationId} checkedAt`,
        rubric.evidenceFreshnessDays.formalProof, evaluatedAtMs, effectiveAtMs, errors);
      push(errors, ['kernel_checked', 'failed'].includes(proof.status),
        `invalid proof status: ${proof.obligationId}`);
      if (obligation.researchArtifactBound) {
        validateDigest(proof.researchArtifactDigest,
          `proof ${proof.obligationId} researchArtifactDigest`, errors);
      } else {
        push(errors, proof.researchArtifactDigest === null,
          `non-research proof must not bind a research artifact: ${proof.obligationId}`);
      }
      const passed = proof.status === 'kernel_checked';
      proofStatuses.set(proof.obligationId, passed);
      proofEvidenceById.set(proof.evidenceId, { proof, obligation, passed });
    }
  }
  const requiredObligationIds = rubric.formalProofObligations
    .filter((obligation) => obligation.requiredForQualification)
    .map((obligation) => obligation.obligationId);
  const kernelCheckedObligationIds = requiredObligationIds
    .filter((obligationId) => proofStatuses.get(obligationId) === true);
  const missingOrFailedObligationIds = requiredObligationIds
    .filter((obligationId) => proofStatuses.get(obligationId) !== true);
  const formalSatisfied = missingOrFailedObligationIds.length === 0;

  const specializationKeys = new Set(['declaredTracks', 'examAttempt']);
  let specializationPassed = false;
  let declaredTracks = [];
  if (!exactKeys(evidence.specialization, specializationKeys)
    || !Array.isArray(evidence.specialization?.declaredTracks)) {
    errors.push('specialization evidence contains missing or unknown fields');
  } else {
    declaredTracks = evidence.specialization.declaredTracks;
    push(errors, uniqueStrings(declaredTracks), 'specialization declaredTracks must be unique strings');
    push(errors, declaredTracks.length >= blueprint.specializationExam.minimumDeclaredTracks,
      'specialization declares too few tracks');
    push(errors, declaredTracks.every((track) => blueprint.specializationExam.eligibleTracks.includes(track)),
      'specialization declares an ineligible track');
    if (evidence.specialization.examAttempt !== null) {
      specializationPassed = validateExamAttempt({
        attempt: evidence.specialization.examAttempt,
        spec: blueprint.specializationExam,
        specDigest: program.examSpecDigests[blueprint.specializationExam.examId],
        subjectId: evidence.subjectId,
        label: 'specialization exam',
        maximumDays: rubric.evidenceFreshnessDays.specializationExam,
        evaluatedAtMs,
        effectiveAtMs,
        ids,
        errors,
      });
    }
  }
  const specializationSatisfied = specializationPassed
    && declaredTracks.length >= blueprint.specializationExam.minimumDeclaredTracks;

  const researchKeys = new Set([
    'evidenceId', 'subjectId', 'artifactId', 'artifactDigest', 'boundedClaim', 'corpus',
    'reproduction', 'review', 'formalProofEvidenceIds', 'novelty', 'completedAt',
  ]);
  const corpusKeys = new Set(['description', 'corpusDigest', 'protocolDigest']);
  const reproductionKeys = new Set([
    'status', 'independent', 'reproducerId', 'environmentDigest', 'resultDigest', 'completedAt',
  ]);
  const reviewKeys = new Set([
    'status', 'independent', 'reviewerId', 'reviewDigest', 'completedAt',
  ]);
  const noveltyKeys = new Set(['status', 'scopeStatement', 'evidenceDigest']);
  let researchArtifactId = null;
  let researchReproducible = false;
  let researchFormalPassed = false;
  let researchSatisfied = false;
  let novelty = {
    status: 'unestablished',
    scopeStatement: 'No valid research novelty evidence was supplied.',
    globalNoveltyInferred: false,
  };
  if (evidence.research !== null) {
    const research = evidence.research;
    if (!exactKeys(research, researchKeys)) {
      errors.push('research evidence contains missing or unknown fields');
    } else {
      validateEvidenceId(research.evidenceId, 'research artifact', ids, errors);
      validateSubject(research.subjectId, evidence.subjectId, 'research artifact', errors);
      push(errors, IDENTIFIER.test(research.artifactId), 'invalid research artifactId');
      researchArtifactId = research.artifactId;
      validateDigest(research.artifactDigest, 'research artifactDigest', errors);
      push(errors, typeof research.boundedClaim === 'string' && research.boundedClaim.trim().length >= 20,
        'research boundedClaim is too short');
      validateFreshTimestamp(research.completedAt, 'research completedAt',
        rubric.evidenceFreshnessDays.researchArtifact, evaluatedAtMs, effectiveAtMs, errors);

      push(errors, exactKeys(research.corpus, corpusKeys), 'research corpus evidence is invalid');
      if (record(research.corpus)) {
        push(errors, nonEmpty(research.corpus.description), 'research corpus description is required');
        validateDigest(research.corpus.corpusDigest, 'research corpusDigest', errors);
        validateDigest(research.corpus.protocolDigest, 'research corpus protocolDigest', errors);
      }
      push(errors, exactKeys(research.reproduction, reproductionKeys),
        'research reproduction evidence is invalid');
      if (record(research.reproduction)) {
        push(errors, research.reproduction.status === 'passed', 'research reproduction did not pass');
        push(errors, research.reproduction.independent === true, 'research reproduction is not independent');
        push(errors, nonEmpty(research.reproduction.reproducerId), 'research reproducerId is required');
        validateDigest(research.reproduction.environmentDigest, 'research environmentDigest', errors);
        validateDigest(research.reproduction.resultDigest, 'research reproduction resultDigest', errors);
        validateFreshTimestamp(research.reproduction.completedAt, 'research reproduction completedAt',
          rubric.evidenceFreshnessDays.researchArtifact, evaluatedAtMs, effectiveAtMs, errors);
        researchReproducible = research.reproduction.status === 'passed'
          && research.reproduction.independent === true;
      }
      push(errors, exactKeys(research.review, reviewKeys), 'research review evidence is invalid');
      let reviewPassed = false;
      if (record(research.review)) {
        push(errors, research.review.status === 'passed', 'research independent review did not pass');
        push(errors, research.review.independent === true, 'research review is not independent');
        push(errors, nonEmpty(research.review.reviewerId), 'research reviewerId is required');
        validateDigest(research.review.reviewDigest, 'research reviewDigest', errors);
        validateFreshTimestamp(research.review.completedAt, 'research review completedAt',
          rubric.evidenceFreshnessDays.researchArtifact, evaluatedAtMs, effectiveAtMs, errors);
        reviewPassed = research.review.status === 'passed' && research.review.independent === true;
      }
      push(errors, uniqueStrings(research.formalProofEvidenceIds)
        && research.formalProofEvidenceIds.length > 0, 'research formalProofEvidenceIds are required');
      const boundProofs = (research.formalProofEvidenceIds || []).map((evidenceId) => proofEvidenceById.get(evidenceId));
      push(errors, boundProofs.every(Boolean), 'research references unknown formal proof evidence');
      researchFormalPassed = boundProofs.length > 0 && boundProofs.every((item) => (
        item
        && item.passed
        && item.obligation.researchArtifactBound
        && item.proof.researchArtifactDigest === research.artifactDigest
      ));
      push(errors, researchFormalPassed, 'research main-result proof does not bind the artifact digest');

      push(errors, exactKeys(research.novelty, noveltyKeys), 'research novelty evidence is invalid');
      if (record(research.novelty)) {
        push(errors, NOVELTY_STATUSES.includes(research.novelty.status), 'unknown research novelty status');
        push(errors, nonEmpty(research.novelty.scopeStatement), 'research novelty scopeStatement is required');
        validateDigest(research.novelty.evidenceDigest, 'research novelty evidenceDigest', errors);
        novelty = {
          status: NOVELTY_STATUSES.includes(research.novelty.status)
            ? research.novelty.status
            : 'unestablished',
          scopeStatement: nonEmpty(research.novelty.scopeStatement)
            ? research.novelty.scopeStatement
            : 'Novelty scope evidence is invalid.',
          globalNoveltyInferred: false,
        };
      }
      researchSatisfied = researchReproducible && reviewPassed && researchFormalPassed;
    }
  }

  const integrityOk = errors.length === 0;
  const declaredGatesSatisfied = integrityOk
    && breadthSatisfied
    && qualifyingSatisfied
    && formalSatisfied
    && specializationSatisfied
    && researchSatisfied;
  // This pure module validates shape and recomputes declared gates. It has no
  // signature secret, provider replay, retention chain, or deployed-tree
  // authority, so it can never emit the live capability claim.
  const qualified = false;
  const ownStageStatus = {
    proof_foundations: stageBreadth.find((stage) => stage.stageId === 'proof_foundations')
      ?.requiredCoverageSatisfied === true,
    undergraduate_core: stageBreadth.find((stage) => stage.stageId === 'undergraduate_core')
      ?.requiredCoverageSatisfied === true,
    graduate_core: stageBreadth.find((stage) => stage.stageId === 'graduate_core')
      ?.requiredCoverageSatisfied === true,
    qualifying: qualifyingSatisfied && formalSatisfied,
    specialization: specializationSatisfied,
    research: researchSatisfied,
  };
  let prerequisitesSatisfied = integrityOk;
  const stages = STAGES.map((stageId) => {
    const satisfied = prerequisitesSatisfied && ownStageStatus[stageId];
    prerequisitesSatisfied = satisfied;
    return { stageId, satisfied };
  });

  return {
    schemaVersion: PHD_REPORT_SCHEMA,
    subjectId: evidence.subjectId,
    evaluatedAt: evidence.evaluatedAt,
    evidenceIntegrity: { ok: integrityOk, errors: sortedUnique(errors) },
    program: { valid: program.ok, digests: program.digests, errors: program.errors },
    acquisition: {
      coveredConceptCount,
      submittedConceptCount: conceptStatuses.size,
      allTrajectoryConceptsCovered: graph.concepts.every(
        (concept) => conceptStatuses.get(concept.conceptId) === 'covered',
      ),
    },
    curriculumBreadth: {
      requiredConceptCount: requiredIds.length,
      coveredRequiredConceptCount: requiredIds.length - missingRequired.length,
      missingRequiredConceptIds: missingRequired,
      byStage: stageBreadth,
      satisfied: integrityOk && breadthSatisfied,
    },
    qualifyingPerformance: {
      requiredExamIds,
      passedExamIds,
      missingOrFailedExamIds,
      satisfied: integrityOk && qualifyingSatisfied,
    },
    formalProofEvidence: {
      requiredObligationIds,
      kernelCheckedObligationIds,
      missingOrFailedObligationIds,
      satisfied: integrityOk && formalSatisfied,
    },
    specialization: {
      declaredTracks,
      passed: specializationPassed,
      satisfied: integrityOk && specializationSatisfied,
    },
    research: {
      artifactId: researchArtifactId,
      reproducible: researchReproducible,
      formalProofGatePassed: researchFormalPassed,
      satisfied: integrityOk && researchSatisfied,
    },
    novelty,
    stages,
    capabilities: {
      acquisition_coverage_recorded: integrityOk && coveredConceptCount > 0,
      curriculum_breadth_satisfied: integrityOk && breadthSatisfied,
      qualifying_exams_passed: integrityOk && qualifyingSatisfied,
      formal_proofs_kernel_checked: integrityOk && formalSatisfied,
      specialization_exam_passed: integrityOk && specializationSatisfied,
      bounded_research_gate_passed: integrityOk && researchSatisfied,
      phd_math_qualified: qualified,
    },
    all_declared_schema_gates_satisfied: declaredGatesSatisfied,
    phd_math_qualified: qualified,
    truthBoundary: declaredGatesSatisfied
      ? 'All static evidence-shape gates replayed, but this pure validator cannot establish a live claim. Signed retention, provider, deployment, independent-role, and kernel-replay evidence must pass the production campaign verifier.'
      : 'Course coverage, isolated exam passes, or incomplete research evidence cannot establish phd_math_qualified.',
  };
}
