import { buildAnalyticsAdvisorSnapshot, createAnalyticsAdvisorApiDocument } from '../service-analytics-advisor.mjs';

export function createAnalyticsAdvisorApiRoutes(basePath = '/api/analytics-advisor') {
  const snapshot = buildAnalyticsAdvisorSnapshot();
  return [
    { id: 'analytics-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-advisor.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsAdvisorApiDocument(snapshot) }
  ];
}

