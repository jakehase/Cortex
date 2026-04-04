import { buildAnalyticsAdvisorSnapshot, createAnalyticsAdvisorRouteSummary } from '../service-analytics-advisor.mjs';

export function createAnalyticsAdvisorRegistryRoutes(basePath = '/registry/analytics-advisor') {
  const snapshot = buildAnalyticsAdvisorSnapshot();
  return [
    { id: 'analytics-advisor.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsAdvisorRouteSummary(snapshot) },
    { id: 'analytics-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

