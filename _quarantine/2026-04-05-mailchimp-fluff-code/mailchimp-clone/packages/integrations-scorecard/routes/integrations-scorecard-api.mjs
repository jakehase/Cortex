import { buildIntegrationsScorecardSnapshot, createIntegrationsScorecardApiDocument } from '../service-integrations-scorecard.mjs';

export function createIntegrationsScorecardApiRoutes(basePath = '/api/integrations-scorecard') {
  const snapshot = buildIntegrationsScorecardSnapshot();
  return [
    { id: 'integrations-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsScorecardApiDocument(snapshot) }
  ];
}

