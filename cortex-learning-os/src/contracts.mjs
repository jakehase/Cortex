export const SCHEMAS = Object.freeze({
  capsule: 'cortex.learning_os.capsule.v0',
  curriculumGraph: 'cortex.learning_os.curriculum_graph.v0',
  exam: 'cortex.learning_os.exam.v0',
  answerSet: 'cortex.learning_os.answer_set.v0',
  attempt: 'cortex.learning_os.attempt.v0',
  verifierResult: 'cortex.learning_os.verifier_result.v0',
  mistake: 'cortex.learning_os.mistake.v0',
  lessonCandidate: 'cortex.learning_os.lesson_candidate.v0',
  trustedLesson: 'cortex.learning_os.trusted_lesson.v0',
  promotionReport: 'cortex.learning_os.promotion_report.v0',
  retrievalPack: 'cortex.learning_os.retrieval_pack.v0',
  capabilityReport: 'cortex.learning_os.capability_report.v0',
  runManifest: 'cortex.learning_os.run_manifest.v0'
});

const REQUIRED = Object.freeze({
  [SCHEMAS.capsule]: ['capsuleId', 'domain', 'version', 'trustState', 'activeCurriculumId', 'activeExamIds', 'promotionThresholds', 'truthBoundary'],
  [SCHEMAS.curriculumGraph]: ['curriculumId', 'capsuleId', 'domain', 'version', 'concepts', 'truthBoundary'],
  [SCHEMAS.exam]: ['examId', 'capsuleId', 'version', 'title', 'passThreshold', 'allowedTools', 'items', 'truthBoundary'],
  [SCHEMAS.answerSet]: ['runId', 'answers', 'answerSource', 'toolsUsed', 'evidenceRole', 'startedAt', 'completedAt'],
  [SCHEMAS.attempt]: ['attemptId', 'runId', 'capsuleId', 'examId', 'itemId', 'promptDigest', 'answer', 'answerSource', 'toolsUsed', 'startedAt', 'completedAt'],
  [SCHEMAS.verifierResult]: ['verifierResultId', 'attemptId', 'examId', 'itemId', 'verifierId', 'status', 'score', 'reproducible', 'evidence'],
  [SCHEMAS.mistake]: ['mistakeId', 'attemptId', 'verifierResultId', 'rootCause', 'correction', 'conceptIds', 'recurrenceCount'],
  [SCHEMAS.lessonCandidate]: ['candidateId', 'capsuleId', 'rule', 'supportingEvidenceIds', 'sourceExamIds', 'negativeExampleRefs', 'contraindications', 'requiredRetestIds', 'contradictions'],
  [SCHEMAS.trustedLesson]: ['lessonId', 'candidateId', 'capsuleId', 'rule', 'promotionProof', 'promotedAt', 'retestAfter', 'sourceExamIds'],
  [SCHEMAS.promotionReport]: ['candidateId', 'capsuleId', 'evaluatedAt', 'promoted', 'gates', 'evidenceIds', 'truthBoundary'],
  [SCHEMAS.retrievalPack]: ['capsuleId', 'task', 'trustedLessonIds', 'lessons', 'omittedUntrustedCount', 'estimatedTokens', 'maxTokens', 'truthBoundary'],
  [SCHEMAS.capabilityReport]: ['capsuleId', 'examMatrix', 'allowedClaims', 'rejectedClaims', 'openGaps', 'truthBoundary'],
  [SCHEMAS.runManifest]: ['runId', 'generatedAt', 'files', 'commands', 'truthBoundary']
});

const ARRAY_FIELDS = [
  'activeExamIds', 'allowedTools', 'items', 'answers', 'concepts', 'conceptIds', 'prerequisites', 'outcomes',
  'supportingEvidenceIds', 'sourceExamIds', 'negativeExampleRefs', 'contraindications', 'requiredRetestIds',
  'contradictions', 'trustedLessonIds', 'lessons', 'examMatrix', 'allowedClaims', 'rejectedClaims', 'openGaps',
  'toolsUsed', 'evidence', 'commands', 'files'
];

function requiredErrors(record, fields) {
  return fields.flatMap((key) => {
    const value = record[key];
    if (value === undefined || value === null || value === '') return [`${key} is required`];
    return [];
  });
}

export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['record must be an object'] };
  const required = REQUIRED[record.schemaVersion];
  if (!required) return { ok: false, errors: [`unknown schemaVersion: ${record.schemaVersion || '<missing>'}`] };
  errors.push(...requiredErrors(record, required));
  for (const key of ARRAY_FIELDS) {
    if (key in record && !Array.isArray(record[key])) errors.push(`${key} must be an array`);
  }

  if (record.schemaVersion === SCHEMAS.capsule) {
    if (!['untrained', 'candidate', 'trusted', 'quarantined'].includes(record.trustState)) errors.push('trustState is invalid');
    if (!record.promotionThresholds || typeof record.promotionThresholds !== 'object') errors.push('promotionThresholds must be an object');
  }
  if (record.schemaVersion === SCHEMAS.curriculumGraph) {
    if (!Array.isArray(record.concepts) || record.concepts.length === 0) errors.push('concepts must not be empty');
    const ids = new Set();
    for (const concept of record.concepts || []) {
      errors.push(...requiredErrors(concept, ['conceptId', 'title', 'category', 'prerequisites', 'outcomes']).map((error) => `concept: ${error}`));
      if (ids.has(concept.conceptId)) errors.push(`duplicate conceptId: ${concept.conceptId}`);
      ids.add(concept.conceptId);
    }
  }
  if (record.schemaVersion === SCHEMAS.exam) {
    const threshold = Number(record.passThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) errors.push('passThreshold must be between 0 and 1');
    if (!Array.isArray(record.items) || record.items.length === 0) errors.push('items must not be empty');
    const ids = new Set();
    for (const item of record.items || []) {
      errors.push(...requiredErrors(item, ['itemId', 'prompt', 'conceptIds', 'answerFormat', 'checker']).map((error) => `exam item: ${error}`));
      if (ids.has(item.itemId)) errors.push(`duplicate itemId: ${item.itemId}`);
      ids.add(item.itemId);
      if (!item.checker || !['exact_number', 'exact_integer_string', 'numeric_tolerance', 'exact_string', 'set_equality', 'multiple_choice'].includes(item.checker.mode)) {
        errors.push(`unsupported checker mode for ${item.itemId || '<missing>'}`);
      }
    }
  }
  if (record.schemaVersion === SCHEMAS.verifierResult) {
    if (!['passed', 'failed', 'error'].includes(record.status)) errors.push('status is invalid');
    if (!Number.isFinite(Number(record.score)) || Number(record.score) < 0 || Number(record.score) > 1) errors.push('score must be between 0 and 1');
    if (!Array.isArray(record.evidence) || !record.evidence.length) errors.push('evidence must not be empty');
  }
  if (record.schemaVersion === SCHEMAS.lessonCandidate) {
    for (const key of ['supportingEvidenceIds', 'sourceExamIds', 'negativeExampleRefs', 'contraindications', 'requiredRetestIds']) {
      if (!Array.isArray(record[key]) || record[key].length === 0) errors.push(`${key} must not be empty`);
    }
  }
  if (record.schemaVersion === SCHEMAS.trustedLesson && (typeof record.promotionProof !== 'object' || record.promotionProof?.promoted !== true)) {
    errors.push('promotionProof must record a successful promotion');
  }
  if (record.schemaVersion === SCHEMAS.retrievalPack) {
    if (Number(record.estimatedTokens) > Number(record.maxTokens)) errors.push('retrieval pack exceeds maxTokens');
  }
  return { ok: errors.length === 0, errors };
}
