import { buildTemplateMarketplaceSnapshot, createTemplateMarketplaceChecklist } from '../service-template-marketplace.mjs';

export function createTemplateMarketplaceOpsRoutes(basePath = '/ops/template-marketplace') {
  const snapshot = buildTemplateMarketplaceSnapshot();
  return [
    { id: 'template-marketplace.ops.health', method: 'GET', path: basePath + '/health', checklist: createTemplateMarketplaceChecklist(snapshot) },
    { id: 'template-marketplace.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'template-marketplace.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
