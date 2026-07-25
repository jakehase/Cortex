import { SCHEMAS, validateRecord } from './contracts.mjs';

function terms(value = '') {
  return new Set(String(value).toLowerCase().match(/[a-z0-9]+/g) || []);
}

export function buildRetrievalPack({ capsule, task, trustedLessons = [], candidateLessons = [], now = new Date().toISOString(), limit = 8 } = {}) {
  const taskTerms = terms(task);
  const valid = trustedLessons.filter((lesson) => {
    if (!validateRecord(lesson).ok || lesson.capsuleId !== capsule.capsuleId) return false;
    return !lesson.retestAfter || new Date(lesson.retestAfter).getTime() >= new Date(now).getTime();
  });
  const ranked = valid.map((lesson) => {
    const ruleTerms = terms(lesson.rule);
    const overlap = [...ruleTerms].filter((term) => taskTerms.has(term)).length;
    return { lesson, score: overlap / Math.max(1, ruleTerms.size) };
  }).sort((a, b) => b.score - a.score || a.lesson.lessonId.localeCompare(b.lesson.lessonId)).slice(0, Math.max(1, Number(limit) || 8));
  return {
    schemaVersion: SCHEMAS.retrievalPack,
    generatedAt: now,
    capsuleId: capsule.capsuleId,
    task: String(task || ''),
    trustedLessonIds: ranked.map((row) => row.lesson.lessonId),
    lessons: ranked.map((row) => ({ lessonId: row.lesson.lessonId, rule: row.lesson.rule, relevanceScore: Number(row.score.toFixed(4)), promotionProofDigest: row.lesson.promotionProof?.digest || null })),
    omittedUntrustedCount: candidateLessons.length,
    truthBoundary: 'Only promoted, unexpired trusted lessons are included. Candidate and raw notes are omitted.'
  };
}

export function buildCapabilityReport({ capsule, examResults = [] } = {}) {
  const examMatrix = (capsule.activeExamIds || []).map((examId) => {
    const rows = examResults.filter((result) => result.examId === examId);
    const passed = rows.length > 0 && rows.every((result) => result.status === 'passed' && result.reproducible === true);
    return { examId, attemptCount: rows.length, passed, evidenceIds: rows.flatMap((row) => row.evidence || []) };
  });
  const allPassed = examMatrix.length > 0 && examMatrix.every((row) => row.passed);
  return {
    schemaVersion: SCHEMAS.capabilityReport,
    capsuleId: capsule.capsuleId,
    examMatrix,
    allowedClaims: allPassed ? [`passed_declared_exams_for_${capsule.domain}`] : ['learning_capsule_initialized'],
    rejectedClaims: allPassed ? ['general_domain_mastery'] : ['passed_declared_exams', 'general_domain_mastery'],
    truthBoundary: 'Exam results support only the named exam claims; they do not prove general expertise or modify model weights.'
  };
}
