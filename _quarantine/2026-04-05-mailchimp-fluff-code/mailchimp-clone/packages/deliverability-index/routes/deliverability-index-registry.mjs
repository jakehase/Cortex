import { buildDeliverabilityIndexSnapshot, createDeliverabilityIndexRouteSummary } from '../service-deliverability-index.mjs';

export function createDeliverabilityIndexRegistryRoutes(basePath = '/registry/deliverability-index') {
  const snapshot = buildDeliverabilityIndexSnapshot();
  return [
    { id: 'deliverability-index.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityIndexRouteSummary(snapshot) },
    { id: 'deliverability-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

