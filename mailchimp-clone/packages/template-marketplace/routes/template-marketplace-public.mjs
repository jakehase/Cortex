import { buildTemplateMarketplaceSnapshot } from '../service-template-marketplace.mjs';
import { createTemplateMarketplaceFixtures } from '../fixtures-template-marketplace.mjs';

export function createTemplateMarketplacePublicRoutes(basePath = '/public/template-marketplace') {
  const snapshot = buildTemplateMarketplaceSnapshot();
  const fixtures = createTemplateMarketplaceFixtures();
  return [
    { id: 'template-marketplace.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'template-marketplace.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'template-marketplace.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
