export const SCHEMAS = Object.freeze({
  capsule: 'cortex.learning_os.capsule.v0',
  attempt: 'cortex.learning_os.attempt.v0',
  verifierResult: 'cortex.learning_os.verifier_result.v0',
  mistake: 'cortex.learning_os.mistake.v0',
  lessonCandidate: 'cortex.learning_os.lesson_candidate.v0',
  trustedLesson: 'cortex.learning_os.trusted_lesson.v0',
  retrievalPack: 'cortex.learning_os.retrieval_pack.v0',
  capabilityReport: 'cortex.learning_os.capability_report.v0'
});

const REQUIRED = Object.freeze({
  [SCHEMAS.capsule]: ['capsuleId', 'domain', 'version', 'trustState', 'activeExamIds', 'promotionThresholds'],
  [SCHEMAS.attempt]: ['attemptId', 'capsuleId', 'examId', 'promptDigest', 'answer', 'toolsUsed', 'startedAt', 'completedAt'],
  [SCHEMAS.verifierResult]: ['verifierResultId', 'attemptId', 'examId', 'verifierId', 'status', 'score', 'reproducible', 'evidence'],
  [SCHEMAS.mistake]: ['mistakeId', 'attemptId', 'rootCause', 'correction', 'conceptIds', 'recurrenceCount'],
  [SCHEMAS.lessonCandidate]: ['candidateId', 'capsuleId', 'rule', 'supportingEvidenceIds', 'sourceExamIds', 'contradictions'],
  [SCHEMAS.trustedLesson]: ['lessonId', 'candidateId', 'capsuleId', 'rule', 'promotionProof', 'promotedAt', 'retestAfter'],
  [SCHEMAS.retrievalPack]: ['capsuleId', 'task', 'trustedLessonIds', 'lessons', 'omittedUntrustedCount'],
  [SCHEMAS.capabilityReport]: ['capsuleId', 'examMatrix', 'allowedClaims', 'rejectedClaims', 'truthBoundary']
});

export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['record must be an object'] };
  const required = REQUIRED[record.schemaVersion];
  if (!required) return { ok: false, errors: [`unknown schemaVersion: ${record.schemaVersion || '<missing>'}`] };
  for (const key of required) {
    const value = record[key];
    if (value === undefined || value === null || value === '') errors.push(`${key} is required`);
  }
  if (record.schemaVersion === SCHEMAS.capsule && !['raw', 'candidate', 'trusted', 'quarantined'].includes(record.trustState)) errors.push('trustState is invalid');
  if (record.schemaVersion === SCHEMAS.verifierResult) {
    if (!['passed', 'failed', 'error'].includes(record.status)) errors.push('status is invalid');
    if (!Number.isFinite(Number(record.score)) || Number(record.score) < 0 || Number(record.score) > 1) errors.push('score must be between 0 and 1');
    if (!Array.isArray(record.evidence) || !record.evidence.length) errors.push('evidence must not be empty');
  }
  if (record.schemaVersion === SCHEMAS.trustedLesson && (typeof record.promotionProof !== 'object' || record.promotionProof?.promoted !== true)) {
    errors.push('promotionProof must record a successful promotion');
  }
  for (const key of ['activeExamIds', 'supportingEvidenceIds', 'sourceExamIds', 'contradictions', 'trustedLessonIds', 'lessons', 'examMatrix', 'allowedClaims', 'rejectedClaims']) {
    if (key in record && !Array.isArray(record[key])) errors.push(`${key} must be an array`);
  }
  return { ok: errors.length === 0, errors };
}
