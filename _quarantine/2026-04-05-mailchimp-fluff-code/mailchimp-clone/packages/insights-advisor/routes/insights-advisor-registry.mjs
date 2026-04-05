import { buildInsightsAdvisorSnapshot, createInsightsAdvisorRouteSummary } from '../service-insights-advisor.mjs';

export function createInsightsAdvisorRegistryRoutes(basePath = '/registry/insights-advisor') {
  const snapshot = buildInsightsAdvisorSnapshot();
  return [
    { id: 'insights-advisor.registry.summary', method: 'GET', path: basePath, summary: createInsightsAdvisorRouteSummary(snapshot) },
    { id: 'insights-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

