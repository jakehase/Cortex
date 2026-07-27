import { validateCurriculumGraph } from './curriculum-planner.mjs';

export const ACQUISITION_STATUS_SCHEMA = 'cortex.learning_os.acquisition_status.v1';

export function buildAcquisitionStatus({ state, graph } = {}) {
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid status curriculum graph: ${validation.errors.join('; ')}`);
  const pending = new Set(state.pendingRepairs.map((row) => row.failedConceptId));
  const gateMet = (conceptId) => state.concepts[conceptId]?.state === 'acquired'
    && state.concepts[conceptId].consecutivePasses >= 1;
  const frontier = graph.concepts
    .filter((concept) => ['unassessed', 'learning', 'blocked_prerequisite'].includes(state.concepts[concept.conceptId]?.state)
      && concept.prerequisites.every(gateMet))
    .map((concept) => concept.conceptId);
  const acquiredOnce = [];
  const learningOrCorrection = [];
  const unassessed = [];
  for (const conceptId of validation.topologicalOrder) {
    const record = state.concepts[conceptId];
    if (pending.has(conceptId) || ['learning', 'blocked_prerequisite'].includes(record.state)) {
      learningOrCorrection.push(conceptId);
    } else if (record.state === 'acquired') acquiredOnce.push(conceptId);
    else if (record.state === 'unassessed') unassessed.push(conceptId);
  }
  return {
    schemaVersion: ACQUISITION_STATUS_SCHEMA,
    curriculumId: state.curriculumId,
    revision: state.revision,
    acquiredOnce: { count: acquiredOnce.length, conceptIds: acquiredOnce },
    learningOrCorrection: { count: learningOrCorrection.length, conceptIds: learningOrCorrection },
    unassessed: { count: unassessed.length, conceptIds: unassessed },
    formalQualification: {
      ownership: 'external_integration',
      status: 'not_evaluated_by_acquisition_accelerator',
      conceptIds: [],
    },
    frontier: { count: frontier.length, conceptIds: frontier },
    reviewSelectionEnabled: false,
    truthBoundary: 'Acquired-once records replayed evidence for one covered attempt. It does not assert retention, broad qualification, or model-weight change.',
  };
}
