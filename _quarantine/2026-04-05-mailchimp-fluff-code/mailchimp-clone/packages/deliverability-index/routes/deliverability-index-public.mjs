import { buildDeliverabilityIndexSnapshot } from '../service-deliverability-index.mjs';
import { createDeliverabilityIndexFixtures } from '../fixtures-deliverability-index.mjs';

export function createDeliverabilityIndexPublicRoutes(basePath = '/public/deliverability-index') {
  const snapshot = buildDeliverabilityIndexSnapshot();
  const fixtures = createDeliverabilityIndexFixtures();
  return [
    { id: 'deliverability-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

