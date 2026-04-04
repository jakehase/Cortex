import { buildOnboardingCenterSnapshot, createOnboardingCenterApiDocument } from '../service-onboarding-center.mjs';

export function createOnboardingCenterApiRoutes(basePath = '/api/onboarding-center') {
  const snapshot = buildOnboardingCenterSnapshot();
  return [
    { id: 'onboarding-center.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'onboarding-center.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'onboarding-center.api.document', method: 'GET', path: basePath + '/document', document: createOnboardingCenterApiDocument(snapshot) }
  ];
}
