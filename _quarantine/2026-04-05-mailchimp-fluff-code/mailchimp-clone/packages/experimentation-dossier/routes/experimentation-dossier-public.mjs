import { buildExperimentationDossierSnapshot } from '../service-experimentation-dossier.mjs';
import { createExperimentationDossierFixtures } from '../fixtures-experimentation-dossier.mjs';

export function createExperimentationDossierPublicRoutes(basePath = '/public/experimentation-dossier') {
  const snapshot = buildExperimentationDossierSnapshot();
  const fixtures = createExperimentationDossierFixtures();
  return [
    { id: 'experimentation-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

