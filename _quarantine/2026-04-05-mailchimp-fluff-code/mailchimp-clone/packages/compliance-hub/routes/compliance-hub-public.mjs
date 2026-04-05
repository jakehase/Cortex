import { buildComplianceHubSnapshot } from '../service-compliance-hub.mjs';
import { createComplianceHubFixtures } from '../fixtures-compliance-hub.mjs';

export function createComplianceHubPublicRoutes(basePath = '/public/compliance-hub') {
  const snapshot = buildComplianceHubSnapshot();
  const fixtures = createComplianceHubFixtures();
  return [
    { id: 'compliance-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

