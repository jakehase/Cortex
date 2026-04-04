import { buildIntegrationsIndexSnapshot, createIntegrationsIndexRouteSummary } from '../service-integrations-index.mjs';

export function createIntegrationsIndexRegistryRoutes(basePath = '/registry/integrations-index') {
  const snapshot = buildIntegrationsIndexSnapshot();
  return [
    { id: 'integrations-index.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsIndexRouteSummary(snapshot) },
    { id: 'integrations-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

