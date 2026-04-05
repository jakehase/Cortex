import { buildAnalyticsWorkbenchSnapshot, createAnalyticsWorkbenchApiDocument } from '../service-analytics-workbench.mjs';

export function createAnalyticsWorkbenchApiRoutes(basePath = '/api/analytics-workbench') {
  const snapshot = buildAnalyticsWorkbenchSnapshot();
  return [
    { id: 'analytics-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-workbench.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsWorkbenchApiDocument(snapshot) }
  ];
}

