import crypto from 'node:crypto';
import { SCHEMAS, validateRecord } from './contracts.mjs';

function digest(value) {
  const canonical = (item) => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item && typeof item === 'object') {
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

export function evaluatePromotion({ capsule, candidate, verifierResults = [], trustedLessons = [], now = new Date().toISOString() } = {}) {
  const errors = [validateRecord(capsule), validateRecord(candidate), ...verifierResults.map(validateRecord)]
    .flatMap((result) => result.errors || []);
  const thresholds = capsule?.promotionThresholds || {};
  const minEvidence = Math.max(1, Number(thresholds.minEvidence ?? 2));
  const minDistinctExams = Math.max(1, Number(thresholds.minDistinctExams ?? 2));
  const minScore = Math.max(0, Math.min(1, Number(thresholds.minScore ?? 0.9)));
  const declaredEvidenceIds = candidate?.supportingEvidenceIds || [];
  const evidenceIds = new Set(declaredEvidenceIds);
  const sourceExamIds = new Set(candidate?.sourceExamIds || []);
  const requiredRetestIds = new Set(candidate?.requiredRetestIds || []);
  const relevantResults = verifierResults.filter((result) => evidenceIds.has(result.verifierResultId));
  const evidenceObservationCounts = relevantResults.reduce((counts, result) => {
    counts.set(result.verifierResultId, (counts.get(result.verifierResultId) || 0) + 1);
    return counts;
  }, new Map());
  const exactEvidenceCoverage = declaredEvidenceIds.length === evidenceIds.size
    && relevantResults.length === evidenceIds.size
    && [...evidenceIds].every((id) => evidenceObservationCounts.get(id) === 1);
  const distinctAttemptIds = new Set(relevantResults.map((result) => result.attemptId));
  const distinctEvidenceExamIds = new Set(relevantResults.map((result) => result.examId));
  const coveredSourceExamIds = new Set(relevantResults.map((result) => result.examId).filter((examId) => sourceExamIds.has(examId)));
  const activeExamIds = new Set(capsule?.activeExamIds || []);
  const passedRetestIds = new Set(relevantResults
    .filter((result) => result.evidenceRole === 'retest' && result.status === 'passed' && result.reproducible === true && Number(result.score) >= minScore)
    .map((result) => result.itemId));
  const contradiction = trustedLessons.some((lesson) =>
    lesson.capsuleId === candidate?.capsuleId &&
    (candidate?.contradictions || []).includes(lesson.lessonId));
  const gates = {
    schemasValid: errors.length === 0,
    candidateCapsuleMatches: Boolean(capsule?.capsuleId)
      && candidate?.capsuleId === capsule.capsuleId,
    exactEvidenceCoverage,
    enoughEvidence: exactEvidenceCoverage && evidenceIds.size >= minEvidence,
    distinctAttempts: distinctAttemptIds.size === relevantResults.length,
    distinctEvidenceExams: distinctEvidenceExamIds.size === relevantResults.length,
    distinctExamCoverage: sourceExamIds.size >= minDistinctExams && coveredSourceExamIds.size >= minDistinctExams,
    exactSourceExamCoverage: coveredSourceExamIds.size === sourceExamIds.size
      && relevantResults.every((result) => sourceExamIds.has(result.examId)),
    sourceExamsActive: sourceExamIds.size > 0 && [...sourceExamIds].every((examId) => activeExamIds.has(examId)),
    verifiersPassed: relevantResults.length > 0 && relevantResults.every((result) => result.status === 'passed' && result.reproducible === true && Number(result.score) >= minScore),
    negativeExampleDocumented: Array.isArray(candidate?.negativeExampleRefs) && candidate.negativeExampleRefs.length > 0,
    contraindicationDocumented: Array.isArray(candidate?.contraindications) && candidate.contraindications.length > 0,
    requiredRetestPassed: requiredRetestIds.size > 0 && [...requiredRetestIds].every((id) => passedRetestIds.has(id)),
    contradictionFree: Array.isArray(candidate?.contradictions) && candidate.contradictions.length === 0 && !contradiction,
    capsuleAllowsPromotion: capsule?.trustState !== 'quarantined'
  };
  const promoted = Object.values(gates).every(Boolean);
  const orderedResults = [...relevantResults]
    .sort((left, right) => left.verifierResultId.localeCompare(right.verifierResultId));
  const verifierResultDigests = orderedResults.map((result) => ({
    verifierResultId: result.verifierResultId,
    attemptId: result.attemptId,
    examId: result.examId,
    digest: digest(result)
  }));
  const proofMaterial = {
    schemaVersion: 'cortex.learning_os.promotion_proof_material.v1',
    evaluatedAt: now,
    capsule,
    candidate,
    thresholds: { minEvidence, minDistinctExams, minScore },
    verifierResults: orderedResults,
    gates
  };
  const promotionProof = {
    schemaVersion: SCHEMAS.promotionReport,
    candidateId: candidate?.candidateId || null,
    capsuleId: capsule?.capsuleId || null,
    evaluatedAt: now,
    promoted,
    gates,
    thresholds: { minEvidence, minDistinctExams, minScore },
    evidenceIds: [...evidenceIds].sort(),
    attemptIds: [...distinctAttemptIds].sort(),
    verifierResultDigests,
    sourceExamIds: [...sourceExamIds].sort(),
    coveredSourceExamIds: [...coveredSourceExamIds].sort(),
    requiredRetestIds: [...requiredRetestIds].sort(),
    validationErrors: errors,
    truthBoundary: 'Promotion proves only that this lesson met the declared evidence gates; it is scoped, expiring, and does not imply domain mastery.',
    digest: digest(proofMaterial)
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
      conceptIds: candidate.conceptIds || [],
      rule: candidate.rule,
      contraindications: candidate.contraindications,
      promotionProof,
      promotedAt: now,
      retestAfter,
      sourceExamIds: [...sourceExamIds].sort()
    }
  };
}
