import { buildDeliverabilityHubSnapshot } from '../service-deliverability-hub.mjs';
import { createDeliverabilityHubFixtures } from '../fixtures-deliverability-hub.mjs';

export function createDeliverabilityHubPublicRoutes(basePath = '/public/deliverability-hub') {
  const snapshot = buildDeliverabilityHubSnapshot();
  const fixtures = createDeliverabilityHubFixtures();
  return [
    { id: 'deliverability-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

