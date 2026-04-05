import { buildExperimentationAtlasSnapshot, createExperimentationAtlasApiDocument } from '../service-experimentation-atlas.mjs';

export function createExperimentationAtlasApiRoutes(basePath = '/api/experimentation-atlas') {
  const snapshot = buildExperimentationAtlasSnapshot();
  return [
    { id: 'experimentation-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-atlas.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationAtlasApiDocument(snapshot) }
  ];
}

