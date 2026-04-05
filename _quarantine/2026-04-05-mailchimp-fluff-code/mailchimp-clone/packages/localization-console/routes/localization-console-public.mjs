import { buildLocalizationConsoleSnapshot } from '../service-localization-console.mjs';
import { createLocalizationConsoleFixtures } from '../fixtures-localization-console.mjs';

export function createLocalizationConsolePublicRoutes(basePath = '/public/localization-console') {
  const snapshot = buildLocalizationConsoleSnapshot();
  const fixtures = createLocalizationConsoleFixtures();
  return [
    { id: 'localization-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

