import { buildDeliverabilityStudioSnapshot, createDeliverabilityStudioRouteSummary } from '../service-deliverability-studio.mjs';

export function createDeliverabilityStudioRegistryRoutes(basePath = '/registry/deliverability-studio') {
  const snapshot = buildDeliverabilityStudioSnapshot();
  return [
    { id: 'deliverability-studio.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityStudioRouteSummary(snapshot) },
    { id: 'deliverability-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

