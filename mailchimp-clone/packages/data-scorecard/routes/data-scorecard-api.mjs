import { buildDataScorecardSnapshot, createDataScorecardApiDocument } from '../service-data-scorecard.mjs';

export function createDataScorecardApiRoutes(basePath = '/api/data-scorecard') {
  const snapshot = buildDataScorecardSnapshot();
  return [
    { id: 'data-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createDataScorecardApiDocument(snapshot) }
  ];
}

