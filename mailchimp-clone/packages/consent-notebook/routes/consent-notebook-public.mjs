import { buildConsentNotebookSnapshot } from '../service-consent-notebook.mjs';
import { createConsentNotebookFixtures } from '../fixtures-consent-notebook.mjs';

export function createConsentNotebookPublicRoutes(basePath = '/public/consent-notebook') {
  const snapshot = buildConsentNotebookSnapshot();
  const fixtures = createConsentNotebookFixtures();
  return [
    { id: 'consent-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

