import { buildInsightsStudioSnapshot, createInsightsStudioRouteSummary } from '../service-insights-studio.mjs';

export function createInsightsStudioRegistryRoutes(basePath = '/registry/insights-studio') {
  const snapshot = buildInsightsStudioSnapshot();
  return [
    { id: 'insights-studio.registry.summary', method: 'GET', path: basePath, summary: createInsightsStudioRouteSummary(snapshot) },
    { id: 'insights-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

