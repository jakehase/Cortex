import { buildActivationHubSnapshot, createActivationHubRouteSummary } from '../service-activation-hub.mjs';

export function createActivationHubRegistryRoutes(basePath = '/registry/activation-hub') {
  const snapshot = buildActivationHubSnapshot();
  return [
    { id: 'activation-hub.registry.summary', method: 'GET', path: basePath, summary: createActivationHubRouteSummary(snapshot) },
    { id: 'activation-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

