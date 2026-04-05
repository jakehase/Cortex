import { buildInsightsVaultSnapshot, createInsightsVaultRouteSummary } from '../service-insights-vault.mjs';

export function createInsightsVaultRegistryRoutes(basePath = '/registry/insights-vault') {
  const snapshot = buildInsightsVaultSnapshot();
  return [
    { id: 'insights-vault.registry.summary', method: 'GET', path: basePath, summary: createInsightsVaultRouteSummary(snapshot) },
    { id: 'insights-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

