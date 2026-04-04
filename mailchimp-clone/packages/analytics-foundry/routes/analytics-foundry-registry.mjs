import { buildAnalyticsFoundrySnapshot, createAnalyticsFoundryRouteSummary } from '../service-analytics-foundry.mjs';

export function createAnalyticsFoundryRegistryRoutes(basePath = '/registry/analytics-foundry') {
  const snapshot = buildAnalyticsFoundrySnapshot();
  return [
    { id: 'analytics-foundry.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsFoundryRouteSummary(snapshot) },
    { id: 'analytics-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

