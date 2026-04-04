import { buildAttributionDossierSnapshot } from '../service-attribution-dossier.mjs';
import { createAttributionDossierFixtures } from '../fixtures-attribution-dossier.mjs';

export function createAttributionDossierPublicRoutes(basePath = '/public/attribution-dossier') {
  const snapshot = buildAttributionDossierSnapshot();
  const fixtures = createAttributionDossierFixtures();
  return [
    { id: 'attribution-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

