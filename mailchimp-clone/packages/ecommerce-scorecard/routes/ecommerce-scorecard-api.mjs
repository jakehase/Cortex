import { buildEcommerceScorecardSnapshot, createEcommerceScorecardApiDocument } from '../service-ecommerce-scorecard.mjs';

export function createEcommerceScorecardApiRoutes(basePath = '/api/ecommerce-scorecard') {
  const snapshot = buildEcommerceScorecardSnapshot();
  return [
    { id: 'ecommerce-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceScorecardApiDocument(snapshot) }
  ];
}

