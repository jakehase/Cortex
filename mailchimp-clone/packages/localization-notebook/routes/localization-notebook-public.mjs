import { buildLocalizationNotebookSnapshot } from '../service-localization-notebook.mjs';
import { createLocalizationNotebookFixtures } from '../fixtures-localization-notebook.mjs';

export function createLocalizationNotebookPublicRoutes(basePath = '/public/localization-notebook') {
  const snapshot = buildLocalizationNotebookSnapshot();
  const fixtures = createLocalizationNotebookFixtures();
  return [
    { id: 'localization-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

