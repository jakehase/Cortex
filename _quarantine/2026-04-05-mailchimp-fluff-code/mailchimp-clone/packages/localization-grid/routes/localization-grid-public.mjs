import { buildLocalizationGridSnapshot } from '../service-localization-grid.mjs';
import { createLocalizationGridFixtures } from '../fixtures-localization-grid.mjs';

export function createLocalizationGridPublicRoutes(basePath = '/public/localization-grid') {
  const snapshot = buildLocalizationGridSnapshot();
  const fixtures = createLocalizationGridFixtures();
  return [
    { id: 'localization-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

