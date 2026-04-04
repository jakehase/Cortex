import { buildComplianceIndexSnapshot } from '../service-compliance-index.mjs';
import { createComplianceIndexFixtures } from '../fixtures-compliance-index.mjs';

export function createComplianceIndexPublicRoutes(basePath = '/public/compliance-index') {
  const snapshot = buildComplianceIndexSnapshot();
  const fixtures = createComplianceIndexFixtures();
  return [
    { id: 'compliance-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

