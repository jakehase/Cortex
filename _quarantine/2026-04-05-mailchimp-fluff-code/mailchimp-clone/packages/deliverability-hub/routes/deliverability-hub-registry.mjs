import { buildDeliverabilityHubSnapshot, createDeliverabilityHubRouteSummary } from '../service-deliverability-hub.mjs';

export function createDeliverabilityHubRegistryRoutes(basePath = '/registry/deliverability-hub') {
  const snapshot = buildDeliverabilityHubSnapshot();
  return [
    { id: 'deliverability-hub.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityHubRouteSummary(snapshot) },
    { id: 'deliverability-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

