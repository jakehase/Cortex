import { buildAcquisitionDossierSnapshot } from '../service-acquisition-dossier.mjs';
import { createAcquisitionDossierFixtures } from '../fixtures-acquisition-dossier.mjs';

export function createAcquisitionDossierPublicRoutes(basePath = '/public/acquisition-dossier') {
  const snapshot = buildAcquisitionDossierSnapshot();
  const fixtures = createAcquisitionDossierFixtures();
  return [
    { id: 'acquisition-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

