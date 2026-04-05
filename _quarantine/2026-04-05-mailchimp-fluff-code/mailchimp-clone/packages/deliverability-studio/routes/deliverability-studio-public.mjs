import { buildDeliverabilityStudioSnapshot } from '../service-deliverability-studio.mjs';
import { createDeliverabilityStudioFixtures } from '../fixtures-deliverability-studio.mjs';

export function createDeliverabilityStudioPublicRoutes(basePath = '/public/deliverability-studio') {
  const snapshot = buildDeliverabilityStudioSnapshot();
  const fixtures = createDeliverabilityStudioFixtures();
  return [
    { id: 'deliverability-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

