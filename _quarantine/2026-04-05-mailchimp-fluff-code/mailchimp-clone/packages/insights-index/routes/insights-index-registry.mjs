import { buildInsightsIndexSnapshot, createInsightsIndexRouteSummary } from '../service-insights-index.mjs';

export function createInsightsIndexRegistryRoutes(basePath = '/registry/insights-index') {
  const snapshot = buildInsightsIndexSnapshot();
  return [
    { id: 'insights-index.registry.summary', method: 'GET', path: basePath, summary: createInsightsIndexRouteSummary(snapshot) },
    { id: 'insights-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

