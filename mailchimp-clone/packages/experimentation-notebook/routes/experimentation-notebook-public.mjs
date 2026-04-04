import { buildExperimentationNotebookSnapshot } from '../service-experimentation-notebook.mjs';
import { createExperimentationNotebookFixtures } from '../fixtures-experimentation-notebook.mjs';

export function createExperimentationNotebookPublicRoutes(basePath = '/public/experimentation-notebook') {
  const snapshot = buildExperimentationNotebookSnapshot();
  const fixtures = createExperimentationNotebookFixtures();
  return [
    { id: 'experimentation-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

