import { buildAcquisitionNotebookSnapshot, createAcquisitionNotebookRouteSummary } from '../service-acquisition-notebook.mjs';

export function createAcquisitionNotebookRegistryRoutes(basePath = '/registry/acquisition-notebook') {
  const snapshot = buildAcquisitionNotebookSnapshot();
  return [
    { id: 'acquisition-notebook.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionNotebookRouteSummary(snapshot) },
    { id: 'acquisition-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

