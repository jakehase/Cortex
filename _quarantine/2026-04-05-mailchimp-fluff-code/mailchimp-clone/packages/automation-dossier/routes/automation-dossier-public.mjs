import { buildAutomationDossierSnapshot } from '../service-automation-dossier.mjs';
import { createAutomationDossierFixtures } from '../fixtures-automation-dossier.mjs';

export function createAutomationDossierPublicRoutes(basePath = '/public/automation-dossier') {
  const snapshot = buildAutomationDossierSnapshot();
  const fixtures = createAutomationDossierFixtures();
  return [
    { id: 'automation-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

