import { buildLoyaltyDossierSnapshot } from '../service-loyalty-dossier.mjs';
import { createLoyaltyDossierFixtures } from '../fixtures-loyalty-dossier.mjs';

export function createLoyaltyDossierPublicRoutes(basePath = '/public/loyalty-dossier') {
  const snapshot = buildLoyaltyDossierSnapshot();
  const fixtures = createLoyaltyDossierFixtures();
  return [
    { id: 'loyalty-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

