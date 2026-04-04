import { buildActivationCockpitSnapshot, createActivationCockpitRouteSummary } from '../service-activation-cockpit.mjs';

export function createActivationCockpitRegistryRoutes(basePath = '/registry/activation-cockpit') {
  const snapshot = buildActivationCockpitSnapshot();
  return [
    { id: 'activation-cockpit.registry.summary', method: 'GET', path: basePath, summary: createActivationCockpitRouteSummary(snapshot) },
    { id: 'activation-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

