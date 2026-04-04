import { createDeveloperHubWorkspace, summarizeDeveloperHub } from '../domain-developer-hub.mjs';

export function createDeveloperHubDashboardRoutes(basePath = '/developer-hub') {
  const workspace = createDeveloperHubWorkspace();
  const summary = summarizeDeveloperHub(workspace);
  return [
    { id: 'developer-hub.home', method: 'GET', path: basePath, summary },
    { id: 'developer-hub.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'developer-hub.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
