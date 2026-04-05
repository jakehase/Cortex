import { buildAudienceDossierSnapshot } from '../service-audience-dossier.mjs';
import { createAudienceDossierFixtures } from '../fixtures-audience-dossier.mjs';

export function createAudienceDossierPublicRoutes(basePath = '/public/audience-dossier') {
  const snapshot = buildAudienceDossierSnapshot();
  const fixtures = createAudienceDossierFixtures();
  return [
    { id: 'audience-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

