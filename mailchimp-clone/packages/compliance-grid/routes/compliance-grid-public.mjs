import { buildComplianceGridSnapshot } from '../service-compliance-grid.mjs';
import { createComplianceGridFixtures } from '../fixtures-compliance-grid.mjs';

export function createComplianceGridPublicRoutes(basePath = '/public/compliance-grid') {
  const snapshot = buildComplianceGridSnapshot();
  const fixtures = createComplianceGridFixtures();
  return [
    { id: 'compliance-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

