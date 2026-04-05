import { buildAdvocacyWorkbenchSnapshot, createAdvocacyWorkbenchRouteSummary } from '../service-advocacy-workbench.mjs';

export function createAdvocacyWorkbenchRegistryRoutes(basePath = '/registry/advocacy-workbench') {
  const snapshot = buildAdvocacyWorkbenchSnapshot();
  return [
    { id: 'advocacy-workbench.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyWorkbenchRouteSummary(snapshot) },
    { id: 'advocacy-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

