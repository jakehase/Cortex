import { buildActivationWorkbenchSnapshot, createActivationWorkbenchRouteSummary } from '../service-activation-workbench.mjs';

export function createActivationWorkbenchRegistryRoutes(basePath = '/registry/activation-workbench') {
  const snapshot = buildActivationWorkbenchSnapshot();
  return [
    { id: 'activation-workbench.registry.summary', method: 'GET', path: basePath, summary: createActivationWorkbenchRouteSummary(snapshot) },
    { id: 'activation-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

