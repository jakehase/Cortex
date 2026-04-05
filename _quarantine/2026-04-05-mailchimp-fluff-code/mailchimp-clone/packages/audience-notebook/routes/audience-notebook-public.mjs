import { buildAudienceNotebookSnapshot } from '../service-audience-notebook.mjs';
import { createAudienceNotebookFixtures } from '../fixtures-audience-notebook.mjs';

export function createAudienceNotebookPublicRoutes(basePath = '/public/audience-notebook') {
  const snapshot = buildAudienceNotebookSnapshot();
  const fixtures = createAudienceNotebookFixtures();
  return [
    { id: 'audience-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

