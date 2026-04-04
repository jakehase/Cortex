import { buildCommerceFoundrySnapshot } from '../service-commerce-foundry.mjs';
import { createCommerceFoundryFixtures } from '../fixtures-commerce-foundry.mjs';

export function createCommerceFoundryPublicRoutes(basePath = '/public/commerce-foundry') {
  const snapshot = buildCommerceFoundrySnapshot();
  const fixtures = createCommerceFoundryFixtures();
  return [
    { id: 'commerce-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

