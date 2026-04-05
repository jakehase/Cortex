import { buildLocalizationIndexSnapshot } from '../service-localization-index.mjs';
import { createLocalizationIndexFixtures } from '../fixtures-localization-index.mjs';

export function createLocalizationIndexPublicRoutes(basePath = '/public/localization-index') {
  const snapshot = buildLocalizationIndexSnapshot();
  const fixtures = createLocalizationIndexFixtures();
  return [
    { id: 'localization-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

