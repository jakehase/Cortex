import crypto from 'node:crypto';

import { isContinuousAcquisitionPolicy } from './adaptive-policy.mjs';

const CONCEPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATES = new Set(['unassessed', 'learning', 'acquired', 'review', 'mastered', 'lapsed', 'blocked_prerequisite']);
const EARLY_REVIEW_DIRECTIVE = 'owner_authorized_early_review';
const EARLY_REVIEW_SCOPE = 'single_session';
const EARLY_REVIEW_TRUTH_BOUNDARY = 'This is explicitly early practice, not a due or overdue retention review.';

export function buildEarlyReviewDirective(authorizedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(String(authorizedAt || '')))) throw new Error('invalid early-review authorization timestamp');
  return {
    type: EARLY_REVIEW_DIRECTIVE,
    scope: EARLY_REVIEW_SCOPE,
    authorizedAt,
    truthBoundary: EARLY_REVIEW_TRUTH_BOUNDARY,
  };
}

export function validatePlannerDirective(directive, now) {
  if (directive === null || directive === undefined) return true;
  return directive && typeof directive === 'object' && !Array.isArray(directive)
    && Object.keys(directive).sort().join(',') === ['authorizedAt', 'scope', 'truthBoundary', 'type'].sort().join(',')
    && directive.type === EARLY_REVIEW_DIRECTIVE
    && directive.scope === EARLY_REVIEW_SCOPE
    && directive.authorizedAt === now
    && directive.truthBoundary === EARLY_REVIEW_TRUTH_BOUNDARY
    && Number.isFinite(Date.parse(String(directive.authorizedAt || '')));
}

function stableSeedRank(seed, conceptId) {
  return crypto.createHash('sha256').update(`${seed}:${conceptId}`).digest('hex');
}

export function validateCurriculumGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return { ok: false, errors: ['graph must be an object'] };
  if (!['cortex.learning_os.curriculum_graph.v0', 'cortex.learning_os.curriculum_graph.v1'].includes(graph.schemaVersion)) {
    errors.push('invalid graph schemaVersion');
  }
  if (!CONCEPT_ID.test(String(graph.curriculumId || ''))) errors.push('invalid curriculumId');
  if (!CONCEPT_ID.test(String(graph.capsuleId || ''))) errors.push('invalid capsuleId');
  if (!Array.isArray(graph.concepts) || graph.concepts.length < 1 || graph.concepts.length > 1_000) {
    return { ok: false, errors: [...errors, 'concepts must be a non-empty bounded array'] };
  }
  const byId = new Map();
  for (const concept of graph.concepts) {
    if (!concept || typeof concept !== 'object' || !CONCEPT_ID.test(String(concept.conceptId || ''))) {
      errors.push('invalid concept record');
      continue;
    }
    if (byId.has(concept.conceptId)) errors.push(`duplicate conceptId: ${concept.conceptId}`);
    byId.set(concept.conceptId, concept);
    if (!Array.isArray(concept.prerequisites) || new Set(concept.prerequisites).size !== concept.prerequisites.length) {
      errors.push(`invalid prerequisites: ${concept.conceptId}`);
    }
  }
  for (const concept of byId.values()) {
    for (const prerequisite of concept.prerequisites || []) {
      if (!byId.has(prerequisite)) errors.push(`unknown prerequisite ${prerequisite} for ${concept.conceptId}`);
      if (prerequisite === concept.conceptId) errors.push(`self prerequisite: ${concept.conceptId}`);
    }
  }
  const indegree = new Map([...byId.keys()].map((id) => [id, 0]));
  const dependents = new Map([...byId.keys()].map((id) => [id, []]));
  for (const concept of byId.values()) {
    for (const prerequisite of concept.prerequisites || []) {
      if (!byId.has(prerequisite)) continue;
      indegree.set(concept.conceptId, indegree.get(concept.conceptId) + 1);
      dependents.get(prerequisite).push(concept.conceptId);
    }
  }
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const order = [];
  while (ready.length) {
    const current = ready.shift();
    order.push(current);
    for (const dependent of dependents.get(current).sort()) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (order.length !== byId.size) errors.push('curriculum graph contains a dependency cycle');
  return {
    ok: errors.length === 0,
    errors,
    topologicalOrder: errors.some((error) => error.includes('cycle')) ? [] : order,
    topologicalIndex: Object.fromEntries(order.map((id, index) => [id, index])),
  };
}

export function prerequisiteClosure(graph, conceptId) {
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid curriculum graph: ${validation.errors.join('; ')}`);
  const byId = new Map(graph.concepts.map((concept) => [concept.conceptId, concept]));
  if (!byId.has(conceptId)) throw new Error(`unknown conceptId: ${conceptId}`);
  const found = new Set();
  const visit = (id) => {
    for (const prerequisite of byId.get(id).prerequisites) {
      if (found.has(prerequisite)) continue;
      found.add(prerequisite);
      visit(prerequisite);
    }
  };
  visit(conceptId);
  return validation.topologicalOrder.filter((id) => found.has(id));
}

function conceptRecord(mastery, conceptId) {
  const record = mastery?.concepts?.[conceptId];
  if (!record) {
    return {
      state: 'unassessed', attempts: 0, passes: 0, failures: 0, consecutivePasses: 0,
      consecutiveFailures: 0, reviewStage: 0, nextReviewAt: null,
    };
  }
  if (!STATES.has(record.state)) throw new Error(`invalid mastery state for ${conceptId}`);
  return record;
}

function meetsGate(record, policy, nowMs) {
  const passed = policy.prerequisiteGate.allowedStates.includes(record.state)
    && record.consecutivePasses >= policy.prerequisiteGate.minimumConsecutivePasses;
  if (isContinuousAcquisitionPolicy(policy)) return passed;
  return passed && (policy.prerequisiteGate.overduePassesGate || !record.nextReviewAt || Date.parse(record.nextReviewAt) > nowMs);
}

function confidence(record) {
  if (!record.attempts) return 0;
  return record.passes / record.attempts + Math.min(record.consecutivePasses, 4) / 100;
}

function sortRows(rows, topologicalIndex, seed, { dueFirst = false } = {}) {
  return [...rows].sort((left, right) => {
    if (dueFirst) {
      const due = Date.parse(left.record.nextReviewAt) - Date.parse(right.record.nextReviewAt);
      if (due) return due;
    }
    return topologicalIndex[left.conceptId] - topologicalIndex[right.conceptId]
      || left.conceptId.localeCompare(right.conceptId)
      || stableSeedRank(seed, left.conceptId).localeCompare(stableSeedRank(seed, right.conceptId));
  });
}

export function selectNextAction({
  graph,
  mastery,
  policy,
  now = new Date().toISOString(),
  seed = 'adaptive-default',
  operatorDirective = null,
} = {}) {
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid curriculum graph: ${validation.errors.join('; ')}`);
  if (mastery?.curriculumId !== graph.curriculumId || mastery?.capsuleId !== graph.capsuleId) throw new Error('mastery scope does not match curriculum graph');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('invalid planner timestamp');
  const continuous = isContinuousAcquisitionPolicy(policy);
  if (continuous && operatorDirective !== null && operatorDirective !== undefined) {
    throw new Error('early-review directives are disabled under the continuous-acquisition policy');
  }
  if (!validatePlannerDirective(operatorDirective, now)) throw new Error('invalid adaptive planner operator directive');
  const byId = new Map(graph.concepts.map((concept) => [concept.conceptId, concept]));
  const rows = validation.topologicalOrder.map((conceptId) => ({ conceptId, record: conceptRecord(mastery, conceptId), concept: byId.get(conceptId) }));
  const prerequisitesMeetGate = (row) => row.concept.prerequisites
    .every((id) => meetsGate(conceptRecord(mastery, id), policy, nowMs));
  if (!continuous) {
    const overdue = rows.filter(({ record }) => ['review', 'mastered'].includes(record.state)
      && record.nextReviewAt && Date.parse(record.nextReviewAt) <= nowMs)
      .filter(prerequisitesMeetGate);
    if (overdue.length) {
      const selected = sortRows(overdue, validation.topologicalIndex, seed, { dueFirst: true })[0];
      return {
        kind: 'spaced_review', conceptId: selected.conceptId, role: 'spaced-review',
        reasonCode: 'overdue_spaced_review', evidenceRefs: [`mastery:concepts/${selected.conceptId}/nextReviewAt`],
      };
    }
  }
  for (const pending of mastery.pendingRepairs || []) {
    if (!byId.has(pending.failedConceptId)) continue;
    const closure = prerequisiteClosure(graph, pending.failedConceptId).reverse();
    const unmet = closure.find((conceptId) => !meetsGate(conceptRecord(mastery, conceptId), policy, nowMs));
    if (unmet) {
      if (conceptRecord(mastery, unmet).consecutiveFailures >= policy.budgets.maxAttemptsPerConcept) {
        return {
          kind: 'terminal', conceptId: unmet, role: null,
          reasonCode: 'prerequisite_attempt_budget_exhausted',
          evidenceRefs: [`mastery:concepts/${unmet}/consecutiveFailures`, 'policy:budgets/maxAttemptsPerConcept'],
          blockedConceptId: pending.failedConceptId,
        };
      }
      return {
        kind: 'prerequisite_repair', conceptId: unmet, role: 'correction',
        reasonCode: 'nearest_unmet_prerequisite', evidenceRefs: [`mastery:pendingRepairs/${pending.failedConceptId}`, `graph:concepts/${unmet}`],
        blockedConceptId: pending.failedConceptId,
      };
    }
    const failedRecord = conceptRecord(mastery, pending.failedConceptId);
    if (failedRecord.consecutiveFailures < policy.budgets.maxAttemptsPerConcept) {
      return {
        kind: 'same_concept_correction', conceptId: pending.failedConceptId, role: 'correction',
        reasonCode: 'prerequisites_sufficient_same_concept_retry', evidenceRefs: [`mastery:pendingRepairs/${pending.failedConceptId}`],
      };
    }
    return {
      kind: 'terminal',
      conceptId: pending.failedConceptId,
      role: null,
      reasonCode: 'attempt_budget_exhausted',
      evidenceRefs: [`mastery:concepts/${pending.failedConceptId}/attempts`, `policy:budgets/maxAttemptsPerConcept`],
    };
  }
  const eligible = prerequisitesMeetGate;
  const unassessed = rows.filter((row) => row.record.state === 'unassessed' && eligible(row));
  if (unassessed.length) {
    const selected = sortRows(unassessed, validation.topologicalIndex, seed)[0];
    return {
      kind: 'acquisition', conceptId: selected.conceptId, role: 'acquisition',
      reasonCode: 'eligible_unassessed_concept', evidenceRefs: selected.concept.prerequisites.map((id) => `mastery:concepts/${id}`),
    };
  }
  const learning = rows.filter((row) => ['learning', 'lapsed', 'blocked_prerequisite'].includes(row.record.state)
      && row.record.consecutiveFailures < policy.budgets.maxAttemptsPerConcept && eligible(row))
    .sort((left, right) => confidence(left.record) - confidence(right.record)
      || validation.topologicalIndex[left.conceptId] - validation.topologicalIndex[right.conceptId]
      || left.conceptId.localeCompare(right.conceptId)
      || stableSeedRank(seed, left.conceptId).localeCompare(stableSeedRank(seed, right.conceptId)));
  if (learning.length) {
    return {
      kind: 'learning_retry', conceptId: learning[0].conceptId, role: 'acquisition',
      reasonCode: 'lowest_confidence_eligible_learning', evidenceRefs: [`mastery:concepts/${learning[0].conceptId}`],
    };
  }
  if (!continuous && operatorDirective?.type === EARLY_REVIEW_DIRECTIVE) {
    const futureReviews = rows.filter(({ record }) => ['review', 'mastered'].includes(record.state)
      && record.nextReviewAt && Date.parse(record.nextReviewAt) > nowMs)
      .filter(prerequisitesMeetGate);
    if (futureReviews.length) {
      const selected = sortRows(futureReviews, validation.topologicalIndex, seed, { dueFirst: true })[0];
      return {
        kind: 'spaced_review', conceptId: selected.conceptId, role: 'spaced-review',
        reasonCode: 'owner_authorized_early_review',
        evidenceRefs: [
          `mastery:concepts/${selected.conceptId}/nextReviewAt`,
          'plan:operatorDirective',
        ],
      };
    }
  }
  return {
    kind: 'terminal',
    conceptId: null,
    role: null,
    reasonCode: continuous ? 'curriculum_frontier_reached' : 'curriculum_currently_satisfied',
    evidenceRefs: ['mastery:revision', 'graph:topologicalOrder'],
  };
}
