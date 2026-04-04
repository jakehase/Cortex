import { createDeveloperHubBrief, validateDeveloperHubPlan } from '../domain-developer-hub.mjs';

export function createDeveloperHubApiRoutes(basePath = '/api/developer-hub') {
  const sample = createDeveloperHubBrief();
  return [
    { id: 'developer-hub.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'developer-hub.validate', method: 'POST', path: basePath + '/validate', validation: validateDeveloperHubPlan(sample) }
  ];
}
