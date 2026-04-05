import { buildActivationDossierSnapshot } from '../service-activation-dossier.mjs';
import { createActivationDossierFixtures } from '../fixtures-activation-dossier.mjs';

export function createActivationDossierPublicRoutes(basePath = '/public/activation-dossier') {
  const snapshot = buildActivationDossierSnapshot();
  const fixtures = createActivationDossierFixtures();
  return [
    { id: 'activation-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

