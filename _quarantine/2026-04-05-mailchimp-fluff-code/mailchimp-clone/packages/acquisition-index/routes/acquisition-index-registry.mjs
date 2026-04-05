import { buildAcquisitionIndexSnapshot, createAcquisitionIndexRouteSummary } from '../service-acquisition-index.mjs';

export function createAcquisitionIndexRegistryRoutes(basePath = '/registry/acquisition-index') {
  const snapshot = buildAcquisitionIndexSnapshot();
  return [
    { id: 'acquisition-index.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionIndexRouteSummary(snapshot) },
    { id: 'acquisition-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

