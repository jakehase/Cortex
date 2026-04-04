import { buildTemplateMarketplaceSnapshot } from '../service-template-marketplace.mjs';

export function createTemplateMarketplaceDashboardRoutes(basePath = '/template-marketplace') {
  const snapshot = buildTemplateMarketplaceSnapshot();
  return [
    { id: 'template-marketplace.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'template-marketplace.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'template-marketplace.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
