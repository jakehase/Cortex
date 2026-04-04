import { createTrustCenterWorkspace, summarizeTrustCenter } from '../domain-trust-center.mjs';

export function createTrustCenterDashboardRoutes(basePath = '/trust-center') {
  const workspace = createTrustCenterWorkspace();
  const summary = summarizeTrustCenter(workspace);
  return [
    { id: 'trust-center.home', method: 'GET', path: basePath, summary },
    { id: 'trust-center.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'trust-center.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
