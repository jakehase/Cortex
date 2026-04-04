import { buildAnalyticsAtlasSnapshot, createAnalyticsAtlasApiDocument } from '../service-analytics-atlas.mjs';

export function createAnalyticsAtlasApiRoutes(basePath = '/api/analytics-atlas') {
  const snapshot = buildAnalyticsAtlasSnapshot();
  return [
    { id: 'analytics-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-atlas.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsAtlasApiDocument(snapshot) }
  ];
}

