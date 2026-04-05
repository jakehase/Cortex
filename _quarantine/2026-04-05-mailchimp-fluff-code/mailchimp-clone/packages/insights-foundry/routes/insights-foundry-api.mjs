import { buildInsightsFoundrySnapshot, createInsightsFoundryApiDocument } from '../service-insights-foundry.mjs';

export function createInsightsFoundryApiRoutes(basePath = '/api/insights-foundry') {
  const snapshot = buildInsightsFoundrySnapshot();
  return [
    { id: 'insights-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-foundry.api.document', method: 'GET', path: basePath + '/document', document: createInsightsFoundryApiDocument(snapshot) }
  ];
}

