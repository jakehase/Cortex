import { buildDeliverabilityConsoleSnapshot, createDeliverabilityConsoleRouteSummary } from '../service-deliverability-console.mjs';

export function createDeliverabilityConsoleRegistryRoutes(basePath = '/registry/deliverability-console') {
  const snapshot = buildDeliverabilityConsoleSnapshot();
  return [
    { id: 'deliverability-console.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityConsoleRouteSummary(snapshot) },
    { id: 'deliverability-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

