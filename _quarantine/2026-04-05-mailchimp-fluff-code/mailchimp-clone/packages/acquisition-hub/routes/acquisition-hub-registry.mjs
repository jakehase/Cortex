import { buildAcquisitionHubSnapshot, createAcquisitionHubRouteSummary } from '../service-acquisition-hub.mjs';

export function createAcquisitionHubRegistryRoutes(basePath = '/registry/acquisition-hub') {
  const snapshot = buildAcquisitionHubSnapshot();
  return [
    { id: 'acquisition-hub.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionHubRouteSummary(snapshot) },
    { id: 'acquisition-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

