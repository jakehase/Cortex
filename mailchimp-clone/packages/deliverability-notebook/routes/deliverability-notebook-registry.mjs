import { buildDeliverabilityNotebookSnapshot, createDeliverabilityNotebookRouteSummary } from '../service-deliverability-notebook.mjs';

export function createDeliverabilityNotebookRegistryRoutes(basePath = '/registry/deliverability-notebook') {
  const snapshot = buildDeliverabilityNotebookSnapshot();
  return [
    { id: 'deliverability-notebook.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityNotebookRouteSummary(snapshot) },
    { id: 'deliverability-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

