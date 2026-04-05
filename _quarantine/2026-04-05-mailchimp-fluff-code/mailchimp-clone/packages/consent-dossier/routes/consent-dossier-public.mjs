import { buildConsentDossierSnapshot } from '../service-consent-dossier.mjs';
import { createConsentDossierFixtures } from '../fixtures-consent-dossier.mjs';

export function createConsentDossierPublicRoutes(basePath = '/public/consent-dossier') {
  const snapshot = buildConsentDossierSnapshot();
  const fixtures = createConsentDossierFixtures();
  return [
    { id: 'consent-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

