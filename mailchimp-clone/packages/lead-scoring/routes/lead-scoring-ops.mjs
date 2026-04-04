import { buildLeadScoringSnapshot, createLeadScoringChecklist } from '../service-lead-scoring.mjs';

export function createLeadScoringOpsRoutes(basePath = '/ops/lead-scoring') {
  const snapshot = buildLeadScoringSnapshot();
  return [
    { id: 'lead-scoring.ops.health', method: 'GET', path: basePath + '/health', checklist: createLeadScoringChecklist(snapshot) },
    { id: 'lead-scoring.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'lead-scoring.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
