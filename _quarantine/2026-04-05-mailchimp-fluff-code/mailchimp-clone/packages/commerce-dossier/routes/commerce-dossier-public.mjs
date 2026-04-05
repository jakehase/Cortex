import { buildCommerceDossierSnapshot } from '../service-commerce-dossier.mjs';
import { createCommerceDossierFixtures } from '../fixtures-commerce-dossier.mjs';

export function createCommerceDossierPublicRoutes(basePath = '/public/commerce-dossier') {
  const snapshot = buildCommerceDossierSnapshot();
  const fixtures = createCommerceDossierFixtures();
  return [
    { id: 'commerce-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

