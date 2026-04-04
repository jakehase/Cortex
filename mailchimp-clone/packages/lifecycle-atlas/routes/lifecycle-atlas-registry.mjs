import { buildLifecycleAtlasSnapshot, createLifecycleAtlasRouteSummary } from '../service-lifecycle-atlas.mjs';

export function createLifecycleAtlasRegistryRoutes(basePath = '/registry/lifecycle-atlas') {
  const snapshot = buildLifecycleAtlasSnapshot();
  return [
    { id: 'lifecycle-atlas.registry.summary', method: 'GET', path: basePath, summary: createLifecycleAtlasRouteSummary(snapshot) },
    { id: 'lifecycle-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

