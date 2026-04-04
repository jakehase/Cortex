import { buildLocalizationHubSnapshot } from '../service-localization-hub.mjs';
import { createLocalizationHubFixtures } from '../fixtures-localization-hub.mjs';

export function createLocalizationHubPublicRoutes(basePath = '/public/localization-hub') {
  const snapshot = buildLocalizationHubSnapshot();
  const fixtures = createLocalizationHubFixtures();
  return [
    { id: 'localization-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

