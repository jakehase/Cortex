import { buildPartnerOnboardingSnapshot } from '../service-partner-onboarding.mjs';

export function createPartnerOnboardingDashboardRoutes(basePath = '/partner-onboarding') { const snapshot = buildPartnerOnboardingSnapshot(); return [{ id: 'partner-onboarding.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'partner-onboarding.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'partner-onboarding.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
