import { buildInsightsFoundrySnapshot, createInsightsFoundryRouteSummary } from '../service-insights-foundry.mjs';

export function createInsightsFoundryRegistryRoutes(basePath = '/registry/insights-foundry') {
  const snapshot = buildInsightsFoundrySnapshot();
  return [
    { id: 'insights-foundry.registry.summary', method: 'GET', path: basePath, summary: createInsightsFoundryRouteSummary(snapshot) },
    { id: 'insights-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

