import { buildCreativeScorecardSnapshot, createCreativeScorecardApiDocument } from '../service-creative-scorecard.mjs';

export function createCreativeScorecardApiRoutes(basePath = '/api/creative-scorecard') {
  const snapshot = buildCreativeScorecardSnapshot();
  return [
    { id: 'creative-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createCreativeScorecardApiDocument(snapshot) }
  ];
}

