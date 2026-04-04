import { buildAcquisitionGridSnapshot, createAcquisitionGridRouteSummary } from '../service-acquisition-grid.mjs';

export function createAcquisitionGridRegistryRoutes(basePath = '/registry/acquisition-grid') {
  const snapshot = buildAcquisitionGridSnapshot();
  return [
    { id: 'acquisition-grid.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionGridRouteSummary(snapshot) },
    { id: 'acquisition-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

