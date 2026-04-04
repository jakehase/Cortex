import { createRevenueOpsWorkspace, summarizeRevenueOps } from '../domain-revenue-ops.mjs';

export function createRevenueOpsDashboardRoutes(basePath = '/revenue-ops') {
  const workspace = createRevenueOpsWorkspace();
  const summary = summarizeRevenueOps(workspace);
  return [
    { id: 'revenue-ops.home', method: 'GET', path: basePath, summary },
    { id: 'revenue-ops.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'revenue-ops.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
