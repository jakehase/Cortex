import { buildActivationIndexSnapshot, createActivationIndexRouteSummary } from '../service-activation-index.mjs';

export function createActivationIndexRegistryRoutes(basePath = '/registry/activation-index') {
  const snapshot = buildActivationIndexSnapshot();
  return [
    { id: 'activation-index.registry.summary', method: 'GET', path: basePath, summary: createActivationIndexRouteSummary(snapshot) },
    { id: 'activation-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

