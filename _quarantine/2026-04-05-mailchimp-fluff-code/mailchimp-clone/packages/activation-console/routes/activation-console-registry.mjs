import { buildActivationConsoleSnapshot, createActivationConsoleRouteSummary } from '../service-activation-console.mjs';

export function createActivationConsoleRegistryRoutes(basePath = '/registry/activation-console') {
  const snapshot = buildActivationConsoleSnapshot();
  return [
    { id: 'activation-console.registry.summary', method: 'GET', path: basePath, summary: createActivationConsoleRouteSummary(snapshot) },
    { id: 'activation-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

