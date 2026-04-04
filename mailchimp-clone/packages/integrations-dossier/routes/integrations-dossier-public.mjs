import { buildIntegrationsDossierSnapshot } from '../service-integrations-dossier.mjs';
import { createIntegrationsDossierFixtures } from '../fixtures-integrations-dossier.mjs';

export function createIntegrationsDossierPublicRoutes(basePath = '/public/integrations-dossier') {
  const snapshot = buildIntegrationsDossierSnapshot();
  const fixtures = createIntegrationsDossierFixtures();
  return [
    { id: 'integrations-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

