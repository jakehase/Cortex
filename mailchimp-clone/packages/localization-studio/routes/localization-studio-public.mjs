import { buildLocalizationStudioSnapshot } from '../service-localization-studio.mjs';
import { createLocalizationStudioFixtures } from '../fixtures-localization-studio.mjs';

export function createLocalizationStudioPublicRoutes(basePath = '/public/localization-studio') {
  const snapshot = buildLocalizationStudioSnapshot();
  const fixtures = createLocalizationStudioFixtures();
  return [
    { id: 'localization-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'localization-studio.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'localization-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
