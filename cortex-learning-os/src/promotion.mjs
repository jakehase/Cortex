import crypto from 'node:crypto';
import { SCHEMAS, validateRecord } from './contracts.mjs';

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function evaluatePromotion({ capsule, candidate, verifierResults = [], now = new Date().toISOString() } = {}) {
  const errors = [validateRecord(capsule), validateRecord(candidate), ...verifierResults.map(validateRecord)]
    .flatMap((result) => result.errors || []);
  const thresholds = capsule?.promotionThresholds || {};
  const minEvidence = Math.max(1, Number(thresholds.minEvidence ?? 2));
  const minDistinctExams = Math.max(1, Number(thresholds.minDistinctExams ?? 2));
  const minScore = Math.max(0, Math.min(1, Number(thresholds.minScore ?? 0.9)));
  const evidenceIds = new Set(candidate?.supportingEvidenceIds || []);
  const sourceExamIds = new Set(candidate?.sourceExamIds || []);
  const relevantResults = verifierResults.filter((result) => evidenceIds.has(result.verifierResultId));
  const coveredSourceExamIds = new Set(relevantResults.map((result) => result.examId).filter((examId) => sourceExamIds.has(examId)));
  const activeExamIds = new Set(capsule?.activeExamIds || []);
  const gates = {
    schemasValid: errors.length === 0,
    enoughEvidence: evidenceIds.size >= minEvidence && relevantResults.length >= minEvidence,
    distinctExamCoverage: sourceExamIds.size >= minDistinctExams && coveredSourceExamIds.size >= minDistinctExams,
    sourceExamsActive: sourceExamIds.size > 0 && [...sourceExamIds].every((examId) => activeExamIds.has(examId)),
    verifiersPassed: relevantResults.length > 0 && relevantResults.every((result) => result.status === 'passed' && result.reproducible === true && Number(result.score) >= minScore),
    contradictionFree: Array.isArray(candidate?.contradictions) && candidate.contradictions.length === 0,
    capsuleAllowsPromotion: capsule?.trustState !== 'quarantined'
  };
  const promoted = Object.values(gates).every(Boolean);
  const promotionProof = {
    schemaVersion: 'cortex.learning_os.promotion_proof.v0',
    evaluatedAt: now,
    promoted,
    gates,
    thresholds: { minEvidence, minDistinctExams, minScore },
    evidenceIds: [...evidenceIds].sort(),
    sourceExamIds: [...sourceExamIds].sort(),
    coveredSourceExamIds: [...coveredSourceExamIds].sort(),
    validationErrors: errors,
    digest: digest({ capsuleId: capsule?.capsuleId, candidateId: candidate?.candidateId, gates, evidenceIds: [...evidenceIds].sort() })
  };
  if (!promoted) return { promoted, promotionProof, trustedLesson: null };
  const retestDays = Math.max(1, Number(thresholds.retestDays ?? 90));
  const retestAfter = new Date(new Date(now).getTime() + retestDays * 86_400_000).toISOString();
  return {
    promoted,
    promotionProof,
    trustedLesson: {
      schemaVersion: SCHEMAS.trustedLesson,
      lessonId: `lesson_${digest(candidate.candidateId).slice(0, 16)}`,
      candidateId: candidate.candidateId,
      capsuleId: candidate.capsuleId,
      rule: candidate.rule,
      promotionProof,
      promotedAt: now,
      retestAfter,
      sourceExamIds: [...sourceExamIds].sort()
    }
  };
}
