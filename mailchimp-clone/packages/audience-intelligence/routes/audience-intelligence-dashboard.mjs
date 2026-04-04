import { createAudienceIntelligenceWorkspace, summarizeAudienceIntelligence } from '../domain-audience-intelligence.mjs';

export function createAudienceIntelligenceDashboardRoutes(basePath = '/audience-intelligence') {
  const workspace = createAudienceIntelligenceWorkspace();
  const summary = summarizeAudienceIntelligence(workspace);
  return [
    { id: 'audience-intelligence.home', method: 'GET', path: basePath, summary },
    { id: 'audience-intelligence.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'audience-intelligence.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
