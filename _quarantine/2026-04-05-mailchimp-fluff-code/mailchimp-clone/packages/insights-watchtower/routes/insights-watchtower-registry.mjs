import { buildInsightsWatchtowerSnapshot, createInsightsWatchtowerRouteSummary } from '../service-insights-watchtower.mjs';

export function createInsightsWatchtowerRegistryRoutes(basePath = '/registry/insights-watchtower') {
  const snapshot = buildInsightsWatchtowerSnapshot();
  return [
    { id: 'insights-watchtower.registry.summary', method: 'GET', path: basePath, summary: createInsightsWatchtowerRouteSummary(snapshot) },
    { id: 'insights-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

