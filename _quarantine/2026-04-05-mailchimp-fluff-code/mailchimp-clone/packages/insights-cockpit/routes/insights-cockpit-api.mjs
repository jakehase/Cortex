import { buildInsightsCockpitSnapshot, createInsightsCockpitApiDocument } from '../service-insights-cockpit.mjs';

export function createInsightsCockpitApiRoutes(basePath = '/api/insights-cockpit') {
  const snapshot = buildInsightsCockpitSnapshot();
  return [
    { id: 'insights-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createInsightsCockpitApiDocument(snapshot) }
  ];
}

