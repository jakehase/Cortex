import { buildComplianceExchangeSnapshot, createComplianceExchangeApiDocument } from '../service-compliance-exchange.mjs';

export function createComplianceExchangeApiRoutes(basePath = '/api/compliance-exchange') {
  const snapshot = buildComplianceExchangeSnapshot();
  return [
    { id: 'compliance-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-exchange.api.document', method: 'GET', path: basePath + '/document', document: createComplianceExchangeApiDocument(snapshot) }
  ];
}

