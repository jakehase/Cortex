import { buildIntegrationsNavigatorSnapshot, createIntegrationsNavigatorRouteSummary } from '../service-integrations-navigator.mjs';

export function createIntegrationsNavigatorRegistryRoutes(basePath = '/registry/integrations-navigator') {
  const snapshot = buildIntegrationsNavigatorSnapshot();
  return [
    { id: 'integrations-navigator.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsNavigatorRouteSummary(snapshot) },
    { id: 'integrations-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

