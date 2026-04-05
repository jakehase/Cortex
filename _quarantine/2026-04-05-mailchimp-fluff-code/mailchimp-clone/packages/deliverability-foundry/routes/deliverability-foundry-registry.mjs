import { buildDeliverabilityFoundrySnapshot, createDeliverabilityFoundryRouteSummary } from '../service-deliverability-foundry.mjs';

export function createDeliverabilityFoundryRegistryRoutes(basePath = '/registry/deliverability-foundry') {
  const snapshot = buildDeliverabilityFoundrySnapshot();
  return [
    { id: 'deliverability-foundry.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityFoundryRouteSummary(snapshot) },
    { id: 'deliverability-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

