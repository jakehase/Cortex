import { buildDeliverabilityGridSnapshot, createDeliverabilityGridRouteSummary } from '../service-deliverability-grid.mjs';

export function createDeliverabilityGridRegistryRoutes(basePath = '/registry/deliverability-grid') {
  const snapshot = buildDeliverabilityGridSnapshot();
  return [
    { id: 'deliverability-grid.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityGridRouteSummary(snapshot) },
    { id: 'deliverability-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

