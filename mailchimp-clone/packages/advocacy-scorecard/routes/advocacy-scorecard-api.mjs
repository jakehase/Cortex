import { buildAdvocacyScorecardSnapshot, createAdvocacyScorecardApiDocument } from '../service-advocacy-scorecard.mjs';

export function createAdvocacyScorecardApiRoutes(basePath = '/api/advocacy-scorecard') {
  const snapshot = buildAdvocacyScorecardSnapshot();
  return [
    { id: 'advocacy-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyScorecardApiDocument(snapshot) }
  ];
}

