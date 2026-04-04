import { buildOnboardingCenterSnapshot, createOnboardingCenterChecklist } from '../service-onboarding-center.mjs';

export function createOnboardingCenterOpsRoutes(basePath = '/ops/onboarding-center') {
  const snapshot = buildOnboardingCenterSnapshot();
  return [
    { id: 'onboarding-center.ops.health', method: 'GET', path: basePath + '/health', checklist: createOnboardingCenterChecklist(snapshot) },
    { id: 'onboarding-center.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'onboarding-center.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
