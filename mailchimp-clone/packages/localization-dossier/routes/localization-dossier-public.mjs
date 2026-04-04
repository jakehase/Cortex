import { buildLocalizationDossierSnapshot } from '../service-localization-dossier.mjs';
import { createLocalizationDossierFixtures } from '../fixtures-localization-dossier.mjs';

export function createLocalizationDossierPublicRoutes(basePath = '/public/localization-dossier') {
  const snapshot = buildLocalizationDossierSnapshot();
  const fixtures = createLocalizationDossierFixtures();
  return [
    { id: 'localization-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

