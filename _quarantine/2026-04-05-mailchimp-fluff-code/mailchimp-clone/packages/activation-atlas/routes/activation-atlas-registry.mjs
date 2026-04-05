import { buildActivationAtlasSnapshot, createActivationAtlasRouteSummary } from '../service-activation-atlas.mjs';

export function createActivationAtlasRegistryRoutes(basePath = '/registry/activation-atlas') {
  const snapshot = buildActivationAtlasSnapshot();
  return [
    { id: 'activation-atlas.registry.summary', method: 'GET', path: basePath, summary: createActivationAtlasRouteSummary(snapshot) },
    { id: 'activation-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

