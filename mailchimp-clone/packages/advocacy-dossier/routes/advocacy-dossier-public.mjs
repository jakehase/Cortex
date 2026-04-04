import { buildAdvocacyDossierSnapshot } from '../service-advocacy-dossier.mjs';
import { createAdvocacyDossierFixtures } from '../fixtures-advocacy-dossier.mjs';

export function createAdvocacyDossierPublicRoutes(basePath = '/public/advocacy-dossier') {
  const snapshot = buildAdvocacyDossierSnapshot();
  const fixtures = createAdvocacyDossierFixtures();
  return [
    { id: 'advocacy-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

