import { buildIntegrationsConsoleSnapshot, createIntegrationsConsoleRouteSummary } from '../service-integrations-console.mjs';

export function createIntegrationsConsoleRegistryRoutes(basePath = '/registry/integrations-console') {
  const snapshot = buildIntegrationsConsoleSnapshot();
  return [
    { id: 'integrations-console.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsConsoleRouteSummary(snapshot) },
    { id: 'integrations-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

