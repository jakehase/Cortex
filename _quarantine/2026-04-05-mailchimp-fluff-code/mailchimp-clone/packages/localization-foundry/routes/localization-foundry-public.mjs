import { buildLocalizationFoundrySnapshot } from '../service-localization-foundry.mjs';
import { createLocalizationFoundryFixtures } from '../fixtures-localization-foundry.mjs';

export function createLocalizationFoundryPublicRoutes(basePath = '/public/localization-foundry') {
  const snapshot = buildLocalizationFoundrySnapshot();
  const fixtures = createLocalizationFoundryFixtures();
  return [
    { id: 'localization-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

