import { buildAcquisitionWatchtowerSnapshot, createAcquisitionWatchtowerRouteSummary } from '../service-acquisition-watchtower.mjs';

export function createAcquisitionWatchtowerRegistryRoutes(basePath = '/registry/acquisition-watchtower') {
  const snapshot = buildAcquisitionWatchtowerSnapshot();
  return [
    { id: 'acquisition-watchtower.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionWatchtowerRouteSummary(snapshot) },
    { id: 'acquisition-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

