import { buildCampaignSentinelSnapshot, createCampaignSentinelRouteSummary } from '../service-campaign-sentinel.mjs';

export function createCampaignSentinelRegistryRoutes(basePath = '/registry/campaign-sentinel') {
  const snapshot = buildCampaignSentinelSnapshot();
  return [
    { id: 'campaign-sentinel.registry.summary', method: 'GET', path: basePath, summary: createCampaignSentinelRouteSummary(snapshot) },
    { id: 'campaign-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

