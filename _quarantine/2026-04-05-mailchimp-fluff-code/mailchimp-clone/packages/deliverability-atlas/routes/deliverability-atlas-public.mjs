import { buildDeliverabilityAtlasSnapshot } from '../service-deliverability-atlas.mjs';
import { createDeliverabilityAtlasFixtures } from '../fixtures-deliverability-atlas.mjs';

export function createDeliverabilityAtlasPublicRoutes(basePath = '/public/deliverability-atlas') {
  const snapshot = buildDeliverabilityAtlasSnapshot();
  const fixtures = createDeliverabilityAtlasFixtures();
  return [
    { id: 'deliverability-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

