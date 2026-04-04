import { buildExperimentationWorkbenchSnapshot } from '../service-experimentation-workbench.mjs';
import { createExperimentationWorkbenchFixtures } from '../fixtures-experimentation-workbench.mjs';

export function createExperimentationWorkbenchPublicRoutes(basePath = '/public/experimentation-workbench') {
  const snapshot = buildExperimentationWorkbenchSnapshot();
  const fixtures = createExperimentationWorkbenchFixtures();
  return [
    { id: 'experimentation-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

