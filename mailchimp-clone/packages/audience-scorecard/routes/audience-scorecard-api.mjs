import { buildAudienceScorecardSnapshot, createAudienceScorecardApiDocument } from '../service-audience-scorecard.mjs';

export function createAudienceScorecardApiRoutes(basePath = '/api/audience-scorecard') {
  const snapshot = buildAudienceScorecardSnapshot();
  return [
    { id: 'audience-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createAudienceScorecardApiDocument(snapshot) }
  ];
}

