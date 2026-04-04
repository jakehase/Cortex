import { buildComplianceNavigatorSnapshot } from '../service-compliance-navigator.mjs';
import { createComplianceNavigatorFixtures } from '../fixtures-compliance-navigator.mjs';

export function createComplianceNavigatorPublicRoutes(basePath = '/public/compliance-navigator') {
  const snapshot = buildComplianceNavigatorSnapshot();
  const fixtures = createComplianceNavigatorFixtures();
  return [
    { id: 'compliance-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

