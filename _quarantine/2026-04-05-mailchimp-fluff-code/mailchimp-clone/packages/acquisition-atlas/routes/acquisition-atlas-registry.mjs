import { buildAcquisitionAtlasSnapshot, createAcquisitionAtlasRouteSummary } from '../service-acquisition-atlas.mjs';

export function createAcquisitionAtlasRegistryRoutes(basePath = '/registry/acquisition-atlas') {
  const snapshot = buildAcquisitionAtlasSnapshot();
  return [
    { id: 'acquisition-atlas.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionAtlasRouteSummary(snapshot) },
    { id: 'acquisition-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

