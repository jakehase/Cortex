import { buildAnalyticsCockpitSnapshot, createAnalyticsCockpitApiDocument } from '../service-analytics-cockpit.mjs';

export function createAnalyticsCockpitApiRoutes(basePath = '/api/analytics-cockpit') {
  const snapshot = buildAnalyticsCockpitSnapshot();
  return [
    { id: 'analytics-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsCockpitApiDocument(snapshot) }
  ];
}

