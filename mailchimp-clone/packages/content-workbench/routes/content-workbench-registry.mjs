import { buildContentWorkbenchSnapshot, createContentWorkbenchRouteSummary } from '../service-content-workbench.mjs';

export function createContentWorkbenchRegistryRoutes(basePath = '/registry/content-workbench') {
  const snapshot = buildContentWorkbenchSnapshot();
  return [
    { id: 'content-workbench.registry.summary', method: 'GET', path: basePath, summary: createContentWorkbenchRouteSummary(snapshot) },
    { id: 'content-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

