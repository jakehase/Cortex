import { buildOnboardingCenterSnapshot } from '../service-onboarding-center.mjs';
import { createOnboardingCenterFixtures } from '../fixtures-onboarding-center.mjs';

export function createOnboardingCenterPublicRoutes(basePath = '/public/onboarding-center') {
  const snapshot = buildOnboardingCenterSnapshot();
  const fixtures = createOnboardingCenterFixtures();
  return [
    { id: 'onboarding-center.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'onboarding-center.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'onboarding-center.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
