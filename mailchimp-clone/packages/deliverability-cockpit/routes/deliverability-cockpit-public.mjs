import { buildDeliverabilityCockpitSnapshot } from '../service-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitFixtures } from '../fixtures-deliverability-cockpit.mjs';

export function createDeliverabilityCockpitPublicRoutes(basePath = '/public/deliverability-cockpit') {
  const snapshot = buildDeliverabilityCockpitSnapshot();
  const fixtures = createDeliverabilityCockpitFixtures();
  return [
    { id: 'deliverability-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

