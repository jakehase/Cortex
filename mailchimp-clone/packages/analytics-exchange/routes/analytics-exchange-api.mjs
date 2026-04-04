import { buildAnalyticsExchangeSnapshot, createAnalyticsExchangeApiDocument } from '../service-analytics-exchange.mjs';

export function createAnalyticsExchangeApiRoutes(basePath = '/api/analytics-exchange') {
  const snapshot = buildAnalyticsExchangeSnapshot();
  return [
    { id: 'analytics-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-exchange.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsExchangeApiDocument(snapshot) }
  ];
}

