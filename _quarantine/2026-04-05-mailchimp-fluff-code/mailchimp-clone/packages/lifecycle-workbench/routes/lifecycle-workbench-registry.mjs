import { buildLifecycleWorkbenchSnapshot, createLifecycleWorkbenchRouteSummary } from '../service-lifecycle-workbench.mjs';

export function createLifecycleWorkbenchRegistryRoutes(basePath = '/registry/lifecycle-workbench') {
  const snapshot = buildLifecycleWorkbenchSnapshot();
  return [
    { id: 'lifecycle-workbench.registry.summary', method: 'GET', path: basePath, summary: createLifecycleWorkbenchRouteSummary(snapshot) },
    { id: 'lifecycle-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

