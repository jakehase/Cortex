import { buildLocalizationNavigatorSnapshot } from '../service-localization-navigator.mjs';
import { createLocalizationNavigatorFixtures } from '../fixtures-localization-navigator.mjs';

export function createLocalizationNavigatorPublicRoutes(basePath = '/public/localization-navigator') {
  const snapshot = buildLocalizationNavigatorSnapshot();
  const fixtures = createLocalizationNavigatorFixtures();
  return [
    { id: 'localization-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

