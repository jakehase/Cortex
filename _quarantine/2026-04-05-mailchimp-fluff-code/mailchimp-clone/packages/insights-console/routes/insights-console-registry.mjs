import { buildInsightsConsoleSnapshot, createInsightsConsoleRouteSummary } from '../service-insights-console.mjs';

export function createInsightsConsoleRegistryRoutes(basePath = '/registry/insights-console') {
  const snapshot = buildInsightsConsoleSnapshot();
  return [
    { id: 'insights-console.registry.summary', method: 'GET', path: basePath, summary: createInsightsConsoleRouteSummary(snapshot) },
    { id: 'insights-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

