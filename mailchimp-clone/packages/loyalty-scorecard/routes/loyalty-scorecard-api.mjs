import { buildLoyaltyScorecardSnapshot, createLoyaltyScorecardApiDocument } from '../service-loyalty-scorecard.mjs';

export function createLoyaltyScorecardApiRoutes(basePath = '/api/loyalty-scorecard') {
  const snapshot = buildLoyaltyScorecardSnapshot();
  return [
    { id: 'loyalty-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyScorecardApiDocument(snapshot) }
  ];
}

