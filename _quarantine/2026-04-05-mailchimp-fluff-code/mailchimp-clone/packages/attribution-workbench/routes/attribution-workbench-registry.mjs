import { buildAttributionWorkbenchSnapshot, createAttributionWorkbenchRouteSummary } from '../service-attribution-workbench.mjs';

export function createAttributionWorkbenchRegistryRoutes(basePath = '/registry/attribution-workbench') {
  const snapshot = buildAttributionWorkbenchSnapshot();
  return [
    { id: 'attribution-workbench.registry.summary', method: 'GET', path: basePath, summary: createAttributionWorkbenchRouteSummary(snapshot) },
    { id: 'attribution-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

