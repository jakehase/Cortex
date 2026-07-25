import { SCHEMAS, validateRecord } from './contracts.mjs';
import { sha256Text } from './hash.mjs';

export function buildMistakes({ exam, attempts = [], verifierResults = [] } = {}) {
  const items = new Map((exam?.items || []).map((item) => [item.itemId, item]));
  const attemptsById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  return verifierResults.filter((result) => result.status === 'failed').map((result) => {
    const item = items.get(result.itemId) || {};
    const attempt = attemptsById.get(result.attemptId) || {};
    const mistake = {
      schemaVersion: SCHEMAS.mistake,
      mistakeId: `mistake_${sha256Text(`${result.verifierResultId}:${result.itemId}`).slice(0, 16)}`,
      attemptId: result.attemptId,
      verifierResultId: result.verifierResultId,
      itemId: result.itemId,
      observedAnswer: attempt.answer,
      rootCause: item.mistakeCategory || 'deterministic_answer_mismatch',
      correction: item.remediation?.correction || item.lessonRule || 'Recompute from the declared premises and verify against an independent check.',
      conceptIds: item.conceptIds || result.conceptIds || [],
      recurrenceCount: 1,
      relatedAttempts: [result.attemptId],
      createdAt: result.generatedAt || attempt.completedAt
    };
    const validation = validateRecord(mistake);
    if (!validation.ok) throw new Error(`generated invalid mistake: ${validation.errors.join('; ')}`);
    return mistake;
  });
}

export function distillCandidate({ capsule, mistake, lessonTemplate, supportingResults = [], now = new Date().toISOString() } = {}) {
  if (!mistake || !lessonTemplate) throw new Error('mistake and lessonTemplate are required');
  const candidate = {
    schemaVersion: SCHEMAS.lessonCandidate,
    candidateId: `candidate_${sha256Text(`${capsule.capsuleId}:${mistake.mistakeId}:${lessonTemplate.rule}`).slice(0, 16)}`,
    capsuleId: capsule.capsuleId,
    conceptIds: mistake.conceptIds,
    rule: lessonTemplate.rule,
    supportingEvidenceIds: supportingResults.map((result) => result.verifierResultId),
    sourceExamIds: [...new Set(supportingResults.map((result) => result.examId))],
    negativeExampleRefs: [mistake.mistakeId],
    contraindications: lessonTemplate.contraindications,
    requiredRetestIds: supportingResults.filter((result) => result.evidenceRole === 'retest').map((result) => result.itemId),
    contradictions: [],
    createdAt: now,
    truthBoundary: 'This is a candidate lesson until every promotion gate passes.'
  };
  const validation = validateRecord(candidate);
  if (!validation.ok) throw new Error(`generated invalid lesson candidate: ${validation.errors.join('; ')}`);
  return candidate;
}

export function selectRemediableFailure({ exam, verifierResults = [] } = {}) {
  const items = new Map((exam?.items || []).map((item) => [item.itemId, item]));
  for (const result of verifierResults) {
    const item = items.get(result.itemId);
    if (result.status === 'failed' && item?.remediation?.lessonTemplate && item.remediation?.correctionItem && item.remediation?.promotionRetestItem && item.remediation?.heldoutRetestItem) {
      return { result, item };
    }
  }
  return null;
}
