import { buildDeliverabilityGridSnapshot } from '../service-deliverability-grid.mjs';
import { createDeliverabilityGridFixtures } from '../fixtures-deliverability-grid.mjs';

export function createDeliverabilityGridPublicRoutes(basePath = '/public/deliverability-grid') {
  const snapshot = buildDeliverabilityGridSnapshot();
  const fixtures = createDeliverabilityGridFixtures();
  return [
    { id: 'deliverability-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

