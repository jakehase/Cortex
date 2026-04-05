import { createAdminStudioWorkspace, summarizeAdminStudio } from '../domain-admin-studio.mjs';

export function createAdminStudioDashboardRoutes(basePath = '/admin-studio') {
  const workspace = createAdminStudioWorkspace();
  const summary = summarizeAdminStudio(workspace);
  return [
    { id: 'admin-studio.home', method: 'GET', path: basePath, summary },
    { id: 'admin-studio.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'admin-studio.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
