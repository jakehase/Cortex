import { buildLocalizationPlannerSnapshot } from '../service-localization-planner.mjs';
import { createLocalizationPlannerFixtures } from '../fixtures-localization-planner.mjs';

export function createLocalizationPlannerPublicRoutes(basePath = '/public/localization-planner') {
  const snapshot = buildLocalizationPlannerSnapshot();
  const fixtures = createLocalizationPlannerFixtures();
  return [
    { id: 'localization-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

