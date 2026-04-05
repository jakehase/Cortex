import { buildIntegrationsFoundrySnapshot, createIntegrationsFoundryRouteSummary } from '../service-integrations-foundry.mjs';

export function createIntegrationsFoundryRegistryRoutes(basePath = '/registry/integrations-foundry') {
  const snapshot = buildIntegrationsFoundrySnapshot();
  return [
    { id: 'integrations-foundry.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsFoundryRouteSummary(snapshot) },
    { id: 'integrations-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

