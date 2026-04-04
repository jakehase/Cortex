import { buildExperimentationAtlasSnapshot, createExperimentationAtlasRouteSummary } from '../service-experimentation-atlas.mjs';

export function createExperimentationAtlasRegistryRoutes(basePath = '/registry/experimentation-atlas') {
  const snapshot = buildExperimentationAtlasSnapshot();
  return [
    { id: 'experimentation-atlas.registry.summary', method: 'GET', path: basePath, summary: createExperimentationAtlasRouteSummary(snapshot) },
    { id: 'experimentation-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

