import { buildComplianceCockpitSnapshot } from '../service-compliance-cockpit.mjs';
import { createComplianceCockpitFixtures } from '../fixtures-compliance-cockpit.mjs';

export function createComplianceCockpitPublicRoutes(basePath = '/public/compliance-cockpit') {
  const snapshot = buildComplianceCockpitSnapshot();
  const fixtures = createComplianceCockpitFixtures();
  return [
    { id: 'compliance-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

