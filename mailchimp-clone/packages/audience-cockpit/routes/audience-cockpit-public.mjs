import { buildAudienceCockpitSnapshot } from '../service-audience-cockpit.mjs';
import { createAudienceCockpitFixtures } from '../fixtures-audience-cockpit.mjs';

export function createAudienceCockpitPublicRoutes(basePath = '/public/audience-cockpit') {
  const snapshot = buildAudienceCockpitSnapshot();
  const fixtures = createAudienceCockpitFixtures();
  return [
    { id: 'audience-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

