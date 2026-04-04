import { buildLifecycleDossierSnapshot } from '../service-lifecycle-dossier.mjs';
import { createLifecycleDossierFixtures } from '../fixtures-lifecycle-dossier.mjs';

export function createLifecycleDossierPublicRoutes(basePath = '/public/lifecycle-dossier') {
  const snapshot = buildLifecycleDossierSnapshot();
  const fixtures = createLifecycleDossierFixtures();
  return [
    { id: 'lifecycle-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

