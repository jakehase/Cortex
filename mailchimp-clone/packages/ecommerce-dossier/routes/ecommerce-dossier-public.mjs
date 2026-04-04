import { buildEcommerceDossierSnapshot } from '../service-ecommerce-dossier.mjs';
import { createEcommerceDossierFixtures } from '../fixtures-ecommerce-dossier.mjs';

export function createEcommerceDossierPublicRoutes(basePath = '/public/ecommerce-dossier') {
  const snapshot = buildEcommerceDossierSnapshot();
  const fixtures = createEcommerceDossierFixtures();
  return [
    { id: 'ecommerce-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

