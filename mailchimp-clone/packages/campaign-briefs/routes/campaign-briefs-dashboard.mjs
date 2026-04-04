import { createCampaignBriefsWorkspace, summarizeCampaignBriefs } from '../domain-campaign-briefs.mjs';

export function createCampaignBriefsDashboardRoutes(basePath = '/campaign-briefs') {
  const workspace = createCampaignBriefsWorkspace();
  const summary = summarizeCampaignBriefs(workspace);
  return [
    { id: 'campaign-briefs.home', method: 'GET', path: basePath, summary },
    { id: 'campaign-briefs.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'campaign-briefs.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
