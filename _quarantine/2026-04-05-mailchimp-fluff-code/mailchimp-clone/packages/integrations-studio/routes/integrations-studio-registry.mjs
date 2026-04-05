import { buildIntegrationsStudioSnapshot, createIntegrationsStudioRouteSummary } from '../service-integrations-studio.mjs';

export function createIntegrationsStudioRegistryRoutes(basePath = '/registry/integrations-studio') {
  const snapshot = buildIntegrationsStudioSnapshot();
  return [
    { id: 'integrations-studio.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsStudioRouteSummary(snapshot) },
    { id: 'integrations-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

