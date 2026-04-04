import { buildInsightsAtlasSnapshot, createInsightsAtlasApiDocument } from '../service-insights-atlas.mjs';

export function createInsightsAtlasApiRoutes(basePath = '/api/insights-atlas') {
  const snapshot = buildInsightsAtlasSnapshot();
  return [
    { id: 'insights-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-atlas.api.document', method: 'GET', path: basePath + '/document', document: createInsightsAtlasApiDocument(snapshot) }
  ];
}

