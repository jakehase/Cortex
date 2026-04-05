import { buildDeliverabilityWatchtowerSnapshot } from '../service-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerFixtures } from '../fixtures-deliverability-watchtower.mjs';

export function createDeliverabilityWatchtowerPublicRoutes(basePath = '/public/deliverability-watchtower') {
  const snapshot = buildDeliverabilityWatchtowerSnapshot();
  const fixtures = createDeliverabilityWatchtowerFixtures();
  return [
    { id: 'deliverability-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

