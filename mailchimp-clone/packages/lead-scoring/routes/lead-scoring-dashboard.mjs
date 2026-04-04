import { buildLeadScoringSnapshot } from '../service-lead-scoring.mjs';

export function createLeadScoringDashboardRoutes(basePath = '/lead-scoring') {
  const snapshot = buildLeadScoringSnapshot();
  return [
    { id: 'lead-scoring.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'lead-scoring.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lead-scoring.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
