import { buildAcquisitionWorkbenchSnapshot, createAcquisitionWorkbenchRouteSummary } from '../service-acquisition-workbench.mjs';

export function createAcquisitionWorkbenchRegistryRoutes(basePath = '/registry/acquisition-workbench') {
  const snapshot = buildAcquisitionWorkbenchSnapshot();
  return [
    { id: 'acquisition-workbench.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionWorkbenchRouteSummary(snapshot) },
    { id: 'acquisition-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

