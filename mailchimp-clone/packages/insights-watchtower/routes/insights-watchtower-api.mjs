import { buildInsightsWatchtowerSnapshot, createInsightsWatchtowerApiDocument } from '../service-insights-watchtower.mjs';

export function createInsightsWatchtowerApiRoutes(basePath = '/api/insights-watchtower') {
  const snapshot = buildInsightsWatchtowerSnapshot();
  return [
    { id: 'insights-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createInsightsWatchtowerApiDocument(snapshot) }
  ];
}

