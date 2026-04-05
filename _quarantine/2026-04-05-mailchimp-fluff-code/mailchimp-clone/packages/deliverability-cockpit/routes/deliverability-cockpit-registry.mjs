import { buildDeliverabilityCockpitSnapshot, createDeliverabilityCockpitRouteSummary } from '../service-deliverability-cockpit.mjs';

export function createDeliverabilityCockpitRegistryRoutes(basePath = '/registry/deliverability-cockpit') {
  const snapshot = buildDeliverabilityCockpitSnapshot();
  return [
    { id: 'deliverability-cockpit.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityCockpitRouteSummary(snapshot) },
    { id: 'deliverability-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

