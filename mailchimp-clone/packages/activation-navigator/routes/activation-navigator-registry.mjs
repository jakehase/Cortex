import { buildActivationNavigatorSnapshot, createActivationNavigatorRouteSummary } from '../service-activation-navigator.mjs';

export function createActivationNavigatorRegistryRoutes(basePath = '/registry/activation-navigator') {
  const snapshot = buildActivationNavigatorSnapshot();
  return [
    { id: 'activation-navigator.registry.summary', method: 'GET', path: basePath, summary: createActivationNavigatorRouteSummary(snapshot) },
    { id: 'activation-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

