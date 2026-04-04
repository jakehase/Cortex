import { createAudienceIntelligenceBrief, validateAudienceIntelligencePlan } from '../domain-audience-intelligence.mjs';

export function createAudienceIntelligenceApiRoutes(basePath = '/api/audience-intelligence') {
  const sample = createAudienceIntelligenceBrief();
  return [
    { id: 'audience-intelligence.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'audience-intelligence.validate', method: 'POST', path: basePath + '/validate', validation: validateAudienceIntelligencePlan(sample) }
  ];
}
