import { SCHEMAS, validateRecord } from './contracts.mjs';

function terms(value = '') {
  return new Set(String(value).toLowerCase().match(/[a-z0-9]+/g) || []);
}

function tokenEstimate(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function refreshTokenEstimate(pack) {
  for (let index = 0; index < 4; index += 1) {
    const estimate = tokenEstimate(pack);
    if (estimate === pack.estimatedTokens) return estimate;
    pack.estimatedTokens = estimate;
  }
  return pack.estimatedTokens;
}

function boundedText(value, name, maximumBytes) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw new RangeError(`${name} exceeds ${maximumBytes} UTF-8 bytes`);
  return text;
}

function boundedCodeList(values, name, { maximumItems = 64, maximumBytes = 128 } = {}) {
  if (!Array.isArray(values) || values.length > maximumItems) throw new RangeError(`${name} exceeds ${maximumItems} items`);
  return values.map((value, index) => boundedText(value, `${name}[${index}]`, maximumBytes));
}

export function buildRetrievalPack({ capsule, task, conceptIds = [], trustedLessons = [], candidateLessons = [], mistakeWarnings = [], now = new Date().toISOString(), limit = 8, maxTokens = 1200 } = {}) {
  const tokenBudget = Number(maxTokens);
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1 || tokenBudget > 100_000) {
    throw new RangeError('maxTokens must be an integer between 1 and 100000');
  }
  const boundedTask = boundedText(task, 'task', 16_384);
  const boundedConceptIds = boundedCodeList(conceptIds, 'conceptIds');
  const taskTerms = terms(`${boundedTask} ${boundedConceptIds.join(' ')}`);
  const valid = trustedLessons.filter((lesson) => {
    if (!validateRecord(lesson).ok || lesson.capsuleId !== capsule.capsuleId) return false;
    return !lesson.retestAfter || new Date(lesson.retestAfter).getTime() >= new Date(now).getTime();
  });
  const ranked = valid.map((lesson) => {
    const lessonTerms = terms(`${lesson.rule} ${(lesson.conceptIds || []).join(' ')}`);
    const overlap = [...lessonTerms].filter((term) => taskTerms.has(term)).length;
    return { lesson, score: overlap / Math.max(1, lessonTerms.size) };
  }).sort((a, b) => b.score - a.score || a.lesson.lessonId.localeCompare(b.lesson.lessonId));

  const lessons = [];
  for (const row of ranked.slice(0, Math.max(1, Number(limit) || 8))) {
    const next = [...lessons, {
      lessonId: row.lesson.lessonId,
      conceptIds: row.lesson.conceptIds || [],
      rule: row.lesson.rule,
      contraindications: row.lesson.contraindications || [],
      relevanceScore: Number(row.score.toFixed(4)),
      promotionProofDigest: row.lesson.promotionProof?.digest || null
    }];
    if (tokenEstimate(next) > tokenBudget) break;
    lessons.push(next.at(-1));
  }
  const warnings = mistakeWarnings
    .filter((warning) => (warning.conceptIds || []).some((id) => boundedConceptIds.includes(id)))
    .slice(0, 4)
    .map((warning) => ({ mistakeId: warning.mistakeId, rootCause: warning.rootCause, correction: warning.correction }));
  const result = {
    schemaVersion: SCHEMAS.retrievalPack,
    generatedAt: now,
    capsuleId: capsule.capsuleId,
    task: boundedTask,
    conceptIds: boundedConceptIds,
    trustedLessonIds: lessons.map((lesson) => lesson.lessonId),
    lessons,
    mistakeWarnings: warnings,
    omittedUntrustedCount: candidateLessons.length,
    estimatedTokens: 0,
    maxTokens: tokenBudget,
    truthBoundary: 'Only promoted, unexpired trusted lessons are included. Candidate and raw notes are omitted; cited warnings are not promoted as lessons.'
  };
  refreshTokenEstimate(result);
  while (result.estimatedTokens > tokenBudget && result.lessons.length > 0) {
    result.lessons.pop();
    result.trustedLessonIds = result.lessons.map((lesson) => lesson.lessonId);
    refreshTokenEstimate(result);
  }
  while (result.estimatedTokens > tokenBudget && result.mistakeWarnings.length > 0) {
    result.mistakeWarnings.pop();
    refreshTokenEstimate(result);
  }
  refreshTokenEstimate(result);
  const validation = validateRecord(result);
  if (!validation.ok || tokenEstimate(result) > tokenBudget) {
    const reasons = validation.ok ? ['retrieval pack exceeds maxTokens'] : validation.errors;
    throw new RangeError(`retrieval pack cannot satisfy its declared bounds: ${reasons.join('; ')}`);
  }
  return result;
}

export function buildCapabilityReport({ capsule, examRuns = [], learningOutcome = null } = {}) {
  const examMatrix = examRuns.map((run) => ({
    examId: run.examId,
    runId: run.runId,
    score: Number(run.score || 0),
    passed: run.passed === true,
    itemCount: Number(run.itemCount || 0),
    evidenceRefs: run.evidenceRefs || []
  }));
  const completed = learningOutcome?.learningLoopCompleted === true;
  const improved = learningOutcome?.improvementObserved === true;
  const conceptId = learningOutcome?.conceptId || null;
  const allowedClaims = ['learning_capsule_initialized'];
  if (completed) allowedClaims.push(`bounded_learning_loop_completed_for_${conceptId}`);
  if (improved) allowedClaims.push(`baseline_failure_followed_by_heldout_pass_for_${conceptId}`);
  return {
    schemaVersion: SCHEMAS.capabilityReport,
    generatedAt: learningOutcome?.generatedAt || new Date().toISOString(),
    capsuleId: capsule.capsuleId,
    examMatrix,
    learningOutcome,
    allowedClaims,
    rejectedClaims: ['general_domain_mastery', 'expert_mathematician', 'model_weight_learning', 'broad_math_improvement'],
    openGaps: [
      'More held-out items and repeated sessions are required to establish durable transfer.',
      'One bounded lesson cannot establish broad domain competence.',
      'Model weights were not changed.'
    ],
    truthBoundary: 'Observed scores and a bounded retest support only the named item/concept claims; they do not prove general expertise or durable model-level learning.'
  };
}
