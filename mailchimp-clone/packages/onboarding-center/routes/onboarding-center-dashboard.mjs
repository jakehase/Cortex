import { buildOnboardingCenterSnapshot } from '../service-onboarding-center.mjs';

export function createOnboardingCenterDashboardRoutes(basePath = '/onboarding-center') {
  const snapshot = buildOnboardingCenterSnapshot();
  return [
    { id: 'onboarding-center.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'onboarding-center.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'onboarding-center.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
