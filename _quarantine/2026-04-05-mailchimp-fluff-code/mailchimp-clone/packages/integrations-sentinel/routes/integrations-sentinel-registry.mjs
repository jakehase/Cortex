import { buildIntegrationsSentinelSnapshot, createIntegrationsSentinelRouteSummary } from '../service-integrations-sentinel.mjs';

export function createIntegrationsSentinelRegistryRoutes(basePath = '/registry/integrations-sentinel') {
  const snapshot = buildIntegrationsSentinelSnapshot();
  return [
    { id: 'integrations-sentinel.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsSentinelRouteSummary(snapshot) },
    { id: 'integrations-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

