import { buildCampaignExchangeSnapshot, createCampaignExchangeReadinessBoard } from '../service-campaign-exchange.mjs';

export function createCampaignExchangeOpsRoutes(basePath = '/ops/campaign-exchange') {
  const snapshot = buildCampaignExchangeSnapshot();
  return [
    { id: 'campaign-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCampaignExchangeReadinessBoard(snapshot) },
    { id: 'campaign-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'campaign-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

