import { buildDeliverabilityWorkbenchSnapshot, createDeliverabilityWorkbenchRouteSummary } from '../service-deliverability-workbench.mjs';

export function createDeliverabilityWorkbenchRegistryRoutes(basePath = '/registry/deliverability-workbench') {
  const snapshot = buildDeliverabilityWorkbenchSnapshot();
  return [
    { id: 'deliverability-workbench.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityWorkbenchRouteSummary(snapshot) },
    { id: 'deliverability-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

