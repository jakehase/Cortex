import { buildComplianceDossierSnapshot } from '../service-compliance-dossier.mjs';
import { createComplianceDossierFixtures } from '../fixtures-compliance-dossier.mjs';

export function createComplianceDossierPublicRoutes(basePath = '/public/compliance-dossier') {
  const snapshot = buildComplianceDossierSnapshot();
  const fixtures = createComplianceDossierFixtures();
  return [
    { id: 'compliance-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

