import { createCampaignBriefsBrief, validateCampaignBriefsPlan } from '../domain-campaign-briefs.mjs';

export function createCampaignBriefsApiRoutes(basePath = '/api/campaign-briefs') {
  const sample = createCampaignBriefsBrief();
  return [
    { id: 'campaign-briefs.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'campaign-briefs.validate', method: 'POST', path: basePath + '/validate', validation: validateCampaignBriefsPlan(sample) }
  ];
}
