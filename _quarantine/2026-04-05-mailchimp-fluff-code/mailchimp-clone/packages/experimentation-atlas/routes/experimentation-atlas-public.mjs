import { buildExperimentationAtlasSnapshot } from '../service-experimentation-atlas.mjs';
import { createExperimentationAtlasFixtures } from '../fixtures-experimentation-atlas.mjs';

export function createExperimentationAtlasPublicRoutes(basePath = '/public/experimentation-atlas') {
  const snapshot = buildExperimentationAtlasSnapshot();
  const fixtures = createExperimentationAtlasFixtures();
  return [
    { id: 'experimentation-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

