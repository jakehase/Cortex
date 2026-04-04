import { buildDeliverabilityNavigatorSnapshot } from '../service-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorFixtures } from '../fixtures-deliverability-navigator.mjs';

export function createDeliverabilityNavigatorPublicRoutes(basePath = '/public/deliverability-navigator') {
  const snapshot = buildDeliverabilityNavigatorSnapshot();
  const fixtures = createDeliverabilityNavigatorFixtures();
  return [
    { id: 'deliverability-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

