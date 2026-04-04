import { buildInsightsExchangeSnapshot, createInsightsExchangeApiDocument } from '../service-insights-exchange.mjs';

export function createInsightsExchangeApiRoutes(basePath = '/api/insights-exchange') {
  const snapshot = buildInsightsExchangeSnapshot();
  return [
    { id: 'insights-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-exchange.api.document', method: 'GET', path: basePath + '/document', document: createInsightsExchangeApiDocument(snapshot) }
  ];
}

