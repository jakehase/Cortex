import { buildCollaborationDossierSnapshot } from '../service-collaboration-dossier.mjs';
import { createCollaborationDossierFixtures } from '../fixtures-collaboration-dossier.mjs';

export function createCollaborationDossierPublicRoutes(basePath = '/public/collaboration-dossier') {
  const snapshot = buildCollaborationDossierSnapshot();
  const fixtures = createCollaborationDossierFixtures();
  return [
    { id: 'collaboration-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

