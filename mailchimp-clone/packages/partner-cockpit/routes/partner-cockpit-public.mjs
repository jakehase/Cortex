import { buildPartnerCockpitSnapshot } from '../service-partner-cockpit.mjs';
import { createPartnerCockpitFixtures } from '../fixtures-partner-cockpit.mjs';

export function createPartnerCockpitPublicRoutes(basePath = '/public/partner-cockpit') {
  const snapshot = buildPartnerCockpitSnapshot();
  const fixtures = createPartnerCockpitFixtures();
  return [
    { id: 'partner-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'partner-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'partner-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

