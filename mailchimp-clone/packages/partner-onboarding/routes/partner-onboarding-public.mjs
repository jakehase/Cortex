import { buildPartnerOnboardingSnapshot } from '../service-partner-onboarding.mjs';
import { createPartnerOnboardingFixtures } from '../fixtures-partner-onboarding.mjs';

export function createPartnerOnboardingPublicRoutes(basePath = '/public/partner-onboarding') { const snapshot = buildPartnerOnboardingSnapshot(); const fixtures = createPartnerOnboardingFixtures(); return [{ id: 'partner-onboarding.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'partner-onboarding.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'partner-onboarding.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
