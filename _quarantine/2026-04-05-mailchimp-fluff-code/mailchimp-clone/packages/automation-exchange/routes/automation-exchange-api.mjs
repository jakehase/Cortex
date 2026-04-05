import { buildAutomationExchangeSnapshot, createAutomationExchangeApiDocument } from '../service-automation-exchange.mjs';

export function createAutomationExchangeApiRoutes(basePath = '/api/automation-exchange') {
  const snapshot = buildAutomationExchangeSnapshot();
  return [
    { id: 'automation-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-exchange.api.document', method: 'GET', path: basePath + '/document', document: createAutomationExchangeApiDocument(snapshot) }
  ];
}

