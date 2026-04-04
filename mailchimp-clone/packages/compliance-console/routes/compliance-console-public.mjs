import { buildComplianceConsoleSnapshot } from '../service-compliance-console.mjs';
import { createComplianceConsoleFixtures } from '../fixtures-compliance-console.mjs';

export function createComplianceConsolePublicRoutes(basePath = '/public/compliance-console') {
  const snapshot = buildComplianceConsoleSnapshot();
  const fixtures = createComplianceConsoleFixtures();
  return [
    { id: 'compliance-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

