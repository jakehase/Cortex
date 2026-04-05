import { createAdminStudioBrief, validateAdminStudioPlan } from '../domain-admin-studio.mjs';

export function createAdminStudioApiRoutes(basePath = '/api/admin-studio') {
  const sample = createAdminStudioBrief();
  return [
    { id: 'admin-studio.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'admin-studio.validate', method: 'POST', path: basePath + '/validate', validation: validateAdminStudioPlan(sample) }
  ];
}
