import { buildIntegrationsGridSnapshot, createIntegrationsGridRouteSummary } from '../service-integrations-grid.mjs';

export function createIntegrationsGridRegistryRoutes(basePath = '/registry/integrations-grid') {
  const snapshot = buildIntegrationsGridSnapshot();
  return [
    { id: 'integrations-grid.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsGridRouteSummary(snapshot) },
    { id: 'integrations-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

