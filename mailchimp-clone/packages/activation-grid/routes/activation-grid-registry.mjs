import { buildActivationGridSnapshot, createActivationGridRouteSummary } from '../service-activation-grid.mjs';

export function createActivationGridRegistryRoutes(basePath = '/registry/activation-grid') {
  const snapshot = buildActivationGridSnapshot();
  return [
    { id: 'activation-grid.registry.summary', method: 'GET', path: basePath, summary: createActivationGridRouteSummary(snapshot) },
    { id: 'activation-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

