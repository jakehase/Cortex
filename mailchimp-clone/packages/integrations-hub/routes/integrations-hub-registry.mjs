import { buildIntegrationsHubSnapshot, createIntegrationsHubRouteSummary } from '../service-integrations-hub.mjs';

export function createIntegrationsHubRegistryRoutes(basePath = '/registry/integrations-hub') {
  const snapshot = buildIntegrationsHubSnapshot();
  return [
    { id: 'integrations-hub.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsHubRouteSummary(snapshot) },
    { id: 'integrations-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

