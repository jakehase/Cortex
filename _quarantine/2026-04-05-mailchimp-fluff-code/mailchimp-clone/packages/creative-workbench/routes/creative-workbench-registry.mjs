import { buildCreativeWorkbenchSnapshot, createCreativeWorkbenchRouteSummary } from '../service-creative-workbench.mjs';

export function createCreativeWorkbenchRegistryRoutes(basePath = '/registry/creative-workbench') {
  const snapshot = buildCreativeWorkbenchSnapshot();
  return [
    { id: 'creative-workbench.registry.summary', method: 'GET', path: basePath, summary: createCreativeWorkbenchRouteSummary(snapshot) },
    { id: 'creative-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

