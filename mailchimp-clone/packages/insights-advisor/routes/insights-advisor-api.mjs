import { buildInsightsAdvisorSnapshot, createInsightsAdvisorApiDocument } from '../service-insights-advisor.mjs';

export function createInsightsAdvisorApiRoutes(basePath = '/api/insights-advisor') {
  const snapshot = buildInsightsAdvisorSnapshot();
  return [
    { id: 'insights-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-advisor.api.document', method: 'GET', path: basePath + '/document', document: createInsightsAdvisorApiDocument(snapshot) }
  ];
}

