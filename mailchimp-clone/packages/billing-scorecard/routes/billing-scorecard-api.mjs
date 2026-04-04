import { buildBillingScorecardSnapshot, createBillingScorecardApiDocument } from '../service-billing-scorecard.mjs';

export function createBillingScorecardApiRoutes(basePath = '/api/billing-scorecard') {
  const snapshot = buildBillingScorecardSnapshot();
  return [
    { id: 'billing-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createBillingScorecardApiDocument(snapshot) }
  ];
}

