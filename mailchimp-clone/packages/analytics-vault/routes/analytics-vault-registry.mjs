import { buildAnalyticsVaultSnapshot, createAnalyticsVaultRouteSummary } from '../service-analytics-vault.mjs';

export function createAnalyticsVaultRegistryRoutes(basePath = '/registry/analytics-vault') {
  const snapshot = buildAnalyticsVaultSnapshot();
  return [
    { id: 'analytics-vault.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsVaultRouteSummary(snapshot) },
    { id: 'analytics-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

