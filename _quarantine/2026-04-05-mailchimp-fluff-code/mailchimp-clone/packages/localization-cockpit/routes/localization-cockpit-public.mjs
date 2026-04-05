import { buildLocalizationCockpitSnapshot } from '../service-localization-cockpit.mjs';
import { createLocalizationCockpitFixtures } from '../fixtures-localization-cockpit.mjs';

export function createLocalizationCockpitPublicRoutes(basePath = '/public/localization-cockpit') {
  const snapshot = buildLocalizationCockpitSnapshot();
  const fixtures = createLocalizationCockpitFixtures();
  return [
    { id: 'localization-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

