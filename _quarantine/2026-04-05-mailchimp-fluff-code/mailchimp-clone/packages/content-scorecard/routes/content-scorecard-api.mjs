import { buildContentScorecardSnapshot, createContentScorecardApiDocument } from '../service-content-scorecard.mjs';

export function createContentScorecardApiRoutes(basePath = '/api/content-scorecard') {
  const snapshot = buildContentScorecardSnapshot();
  return [
    { id: 'content-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createContentScorecardApiDocument(snapshot) }
  ];
}

