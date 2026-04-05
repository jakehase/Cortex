import { buildActivationStudioSnapshot, createActivationStudioRouteSummary } from '../service-activation-studio.mjs';

export function createActivationStudioRegistryRoutes(basePath = '/registry/activation-studio') {
  const snapshot = buildActivationStudioSnapshot();
  return [
    { id: 'activation-studio.registry.summary', method: 'GET', path: basePath, summary: createActivationStudioRouteSummary(snapshot) },
    { id: 'activation-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

