import { buildLocalizationWatchtowerSnapshot } from '../service-localization-watchtower.mjs';
import { createLocalizationWatchtowerFixtures } from '../fixtures-localization-watchtower.mjs';

export function createLocalizationWatchtowerPublicRoutes(basePath = '/public/localization-watchtower') {
  const snapshot = buildLocalizationWatchtowerSnapshot();
  const fixtures = createLocalizationWatchtowerFixtures();
  return [
    { id: 'localization-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

