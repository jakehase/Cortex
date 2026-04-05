import { buildContentDossierSnapshot } from '../service-content-dossier.mjs';
import { createContentDossierFixtures } from '../fixtures-content-dossier.mjs';

export function createContentDossierPublicRoutes(basePath = '/public/content-dossier') {
  const snapshot = buildContentDossierSnapshot();
  const fixtures = createContentDossierFixtures();
  return [
    { id: 'content-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

