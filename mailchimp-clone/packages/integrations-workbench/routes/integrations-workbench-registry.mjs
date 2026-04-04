import { buildIntegrationsWorkbenchSnapshot, createIntegrationsWorkbenchRouteSummary } from '../service-integrations-workbench.mjs';

export function createIntegrationsWorkbenchRegistryRoutes(basePath = '/registry/integrations-workbench') {
  const snapshot = buildIntegrationsWorkbenchSnapshot();
  return [
    { id: 'integrations-workbench.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsWorkbenchRouteSummary(snapshot) },
    { id: 'integrations-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

