import { buildComplianceWatchtowerSnapshot } from '../service-compliance-watchtower.mjs';
import { createComplianceWatchtowerFixtures } from '../fixtures-compliance-watchtower.mjs';

export function createComplianceWatchtowerPublicRoutes(basePath = '/public/compliance-watchtower') {
  const snapshot = buildComplianceWatchtowerSnapshot();
  const fixtures = createComplianceWatchtowerFixtures();
  return [
    { id: 'compliance-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

