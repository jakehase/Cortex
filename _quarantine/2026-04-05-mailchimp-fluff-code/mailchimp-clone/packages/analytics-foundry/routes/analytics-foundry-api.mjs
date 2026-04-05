import { buildAnalyticsFoundrySnapshot, createAnalyticsFoundryApiDocument } from '../service-analytics-foundry.mjs';

export function createAnalyticsFoundryApiRoutes(basePath = '/api/analytics-foundry') {
  const snapshot = buildAnalyticsFoundrySnapshot();
  return [
    { id: 'analytics-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-foundry.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsFoundryApiDocument(snapshot) }
  ];
}

