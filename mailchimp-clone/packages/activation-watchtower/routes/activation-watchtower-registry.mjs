import { buildActivationWatchtowerSnapshot, createActivationWatchtowerRouteSummary } from '../service-activation-watchtower.mjs';

export function createActivationWatchtowerRegistryRoutes(basePath = '/registry/activation-watchtower') {
  const snapshot = buildActivationWatchtowerSnapshot();
  return [
    { id: 'activation-watchtower.registry.summary', method: 'GET', path: basePath, summary: createActivationWatchtowerRouteSummary(snapshot) },
    { id: 'activation-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

