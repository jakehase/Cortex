import { buildDataWorkbenchSnapshot, createDataWorkbenchRouteSummary } from '../service-data-workbench.mjs';

export function createDataWorkbenchRegistryRoutes(basePath = '/registry/data-workbench') {
  const snapshot = buildDataWorkbenchSnapshot();
  return [
    { id: 'data-workbench.registry.summary', method: 'GET', path: basePath, summary: createDataWorkbenchRouteSummary(snapshot) },
    { id: 'data-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

