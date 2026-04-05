import { buildInsightsWorkbenchSnapshot, createInsightsWorkbenchApiDocument } from '../service-insights-workbench.mjs';

export function createInsightsWorkbenchApiRoutes(basePath = '/api/insights-workbench') {
  const snapshot = buildInsightsWorkbenchSnapshot();
  return [
    { id: 'insights-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-workbench.api.document', method: 'GET', path: basePath + '/document', document: createInsightsWorkbenchApiDocument(snapshot) }
  ];
}

