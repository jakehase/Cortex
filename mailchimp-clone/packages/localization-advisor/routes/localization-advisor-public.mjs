import { buildLocalizationAdvisorSnapshot } from '../service-localization-advisor.mjs';
import { createLocalizationAdvisorFixtures } from '../fixtures-localization-advisor.mjs';

export function createLocalizationAdvisorPublicRoutes(basePath = '/public/localization-advisor') {
  const snapshot = buildLocalizationAdvisorSnapshot();
  const fixtures = createLocalizationAdvisorFixtures();
  return [
    { id: 'localization-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

