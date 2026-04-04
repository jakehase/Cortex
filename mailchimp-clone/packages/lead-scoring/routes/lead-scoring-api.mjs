import { buildLeadScoringSnapshot, createLeadScoringApiDocument } from '../service-lead-scoring.mjs';

export function createLeadScoringApiRoutes(basePath = '/api/lead-scoring') {
  const snapshot = buildLeadScoringSnapshot();
  return [
    { id: 'lead-scoring.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lead-scoring.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lead-scoring.api.document', method: 'GET', path: basePath + '/document', document: createLeadScoringApiDocument(snapshot) }
  ];
}
