import { buildDeliverabilityNavigatorSnapshot, createDeliverabilityNavigatorRouteSummary } from '../service-deliverability-navigator.mjs';

export function createDeliverabilityNavigatorRegistryRoutes(basePath = '/registry/deliverability-navigator') {
  const snapshot = buildDeliverabilityNavigatorSnapshot();
  return [
    { id: 'deliverability-navigator.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityNavigatorRouteSummary(snapshot) },
    { id: 'deliverability-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

