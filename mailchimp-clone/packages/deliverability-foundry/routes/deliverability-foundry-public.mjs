import { buildDeliverabilityFoundrySnapshot } from '../service-deliverability-foundry.mjs';
import { createDeliverabilityFoundryFixtures } from '../fixtures-deliverability-foundry.mjs';

export function createDeliverabilityFoundryPublicRoutes(basePath = '/public/deliverability-foundry') {
  const snapshot = buildDeliverabilityFoundrySnapshot();
  const fixtures = createDeliverabilityFoundryFixtures();
  return [
    { id: 'deliverability-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

