import { buildConsentPlannerSnapshot } from '../service-consent-planner.mjs';
import { createConsentPlannerFixtures } from '../fixtures-consent-planner.mjs';

export function createConsentPlannerPublicRoutes(basePath = '/public/consent-planner') {
  const snapshot = buildConsentPlannerSnapshot();
  const fixtures = createConsentPlannerFixtures();
  return [
    { id: 'consent-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

