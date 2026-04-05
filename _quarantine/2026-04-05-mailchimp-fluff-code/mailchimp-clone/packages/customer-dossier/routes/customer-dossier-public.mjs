import { buildCustomerDossierSnapshot } from '../service-customer-dossier.mjs';
import { createCustomerDossierFixtures } from '../fixtures-customer-dossier.mjs';

export function createCustomerDossierPublicRoutes(basePath = '/public/customer-dossier') {
  const snapshot = buildCustomerDossierSnapshot();
  const fixtures = createCustomerDossierFixtures();
  return [
    { id: 'customer-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

