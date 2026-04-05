import { buildCustomerScorecardSnapshot, createCustomerScorecardApiDocument } from '../service-customer-scorecard.mjs';

export function createCustomerScorecardApiRoutes(basePath = '/api/customer-scorecard') {
  const snapshot = buildCustomerScorecardSnapshot();
  return [
    { id: 'customer-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createCustomerScorecardApiDocument(snapshot) }
  ];
}

