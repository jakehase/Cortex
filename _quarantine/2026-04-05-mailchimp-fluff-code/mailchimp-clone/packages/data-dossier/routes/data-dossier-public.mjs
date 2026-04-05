import { buildDataDossierSnapshot } from '../service-data-dossier.mjs';
import { createDataDossierFixtures } from '../fixtures-data-dossier.mjs';

export function createDataDossierPublicRoutes(basePath = '/public/data-dossier') {
  const snapshot = buildDataDossierSnapshot();
  const fixtures = createDataDossierFixtures();
  return [
    { id: 'data-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

