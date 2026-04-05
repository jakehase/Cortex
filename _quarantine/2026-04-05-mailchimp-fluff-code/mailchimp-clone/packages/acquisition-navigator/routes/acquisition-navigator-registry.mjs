import { buildAcquisitionNavigatorSnapshot, createAcquisitionNavigatorRouteSummary } from '../service-acquisition-navigator.mjs';

export function createAcquisitionNavigatorRegistryRoutes(basePath = '/registry/acquisition-navigator') {
  const snapshot = buildAcquisitionNavigatorSnapshot();
  return [
    { id: 'acquisition-navigator.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionNavigatorRouteSummary(snapshot) },
    { id: 'acquisition-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

