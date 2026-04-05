import { buildAttributionScorecardSnapshot, createAttributionScorecardApiDocument } from '../service-attribution-scorecard.mjs';

export function createAttributionScorecardApiRoutes(basePath = '/api/attribution-scorecard') {
  const snapshot = buildAttributionScorecardSnapshot();
  return [
    { id: 'attribution-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createAttributionScorecardApiDocument(snapshot) }
  ];
}

