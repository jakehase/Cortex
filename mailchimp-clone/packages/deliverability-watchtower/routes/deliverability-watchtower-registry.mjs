import { buildDeliverabilityWatchtowerSnapshot, createDeliverabilityWatchtowerRouteSummary } from '../service-deliverability-watchtower.mjs';

export function createDeliverabilityWatchtowerRegistryRoutes(basePath = '/registry/deliverability-watchtower') {
  const snapshot = buildDeliverabilityWatchtowerSnapshot();
  return [
    { id: 'deliverability-watchtower.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityWatchtowerRouteSummary(snapshot) },
    { id: 'deliverability-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

