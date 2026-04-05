import { buildAcquisitionNotebookSnapshot } from '../service-acquisition-notebook.mjs';
import { createAcquisitionNotebookFixtures } from '../fixtures-acquisition-notebook.mjs';

export function createAcquisitionNotebookPublicRoutes(basePath = '/public/acquisition-notebook') {
  const snapshot = buildAcquisitionNotebookSnapshot();
  const fixtures = createAcquisitionNotebookFixtures();
  return [
    { id: 'acquisition-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

