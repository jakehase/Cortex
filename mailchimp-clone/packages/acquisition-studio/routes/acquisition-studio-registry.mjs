import { buildAcquisitionStudioSnapshot, createAcquisitionStudioRouteSummary } from '../service-acquisition-studio.mjs';

export function createAcquisitionStudioRegistryRoutes(basePath = '/registry/acquisition-studio') {
  const snapshot = buildAcquisitionStudioSnapshot();
  return [
    { id: 'acquisition-studio.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionStudioRouteSummary(snapshot) },
    { id: 'acquisition-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

