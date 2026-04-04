import { buildCreativeDossierSnapshot } from '../service-creative-dossier.mjs';
import { createCreativeDossierFixtures } from '../fixtures-creative-dossier.mjs';

export function createCreativeDossierPublicRoutes(basePath = '/public/creative-dossier') {
  const snapshot = buildCreativeDossierSnapshot();
  const fixtures = createCreativeDossierFixtures();
  return [
    { id: 'creative-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

