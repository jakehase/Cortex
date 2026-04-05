import { buildBillingDossierSnapshot } from '../service-billing-dossier.mjs';
import { createBillingDossierFixtures } from '../fixtures-billing-dossier.mjs';

export function createBillingDossierPublicRoutes(basePath = '/public/billing-dossier') {
  const snapshot = buildBillingDossierSnapshot();
  const fixtures = createBillingDossierFixtures();
  return [
    { id: 'billing-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

