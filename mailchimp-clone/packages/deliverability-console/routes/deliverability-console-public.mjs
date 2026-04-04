import { buildDeliverabilityConsoleSnapshot } from '../service-deliverability-console.mjs';
import { createDeliverabilityConsoleFixtures } from '../fixtures-deliverability-console.mjs';

export function createDeliverabilityConsolePublicRoutes(basePath = '/public/deliverability-console') {
  const snapshot = buildDeliverabilityConsoleSnapshot();
  const fixtures = createDeliverabilityConsoleFixtures();
  return [
    { id: 'deliverability-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

