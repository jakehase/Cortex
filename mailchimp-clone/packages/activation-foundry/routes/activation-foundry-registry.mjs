import { buildActivationFoundrySnapshot, createActivationFoundryRouteSummary } from '../service-activation-foundry.mjs';

export function createActivationFoundryRegistryRoutes(basePath = '/registry/activation-foundry') {
  const snapshot = buildActivationFoundrySnapshot();
  return [
    { id: 'activation-foundry.registry.summary', method: 'GET', path: basePath, summary: createActivationFoundryRouteSummary(snapshot) },
    { id: 'activation-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

