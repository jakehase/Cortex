import { buildComplianceStudioSnapshot } from '../service-compliance-studio.mjs';
import { createComplianceStudioFixtures } from '../fixtures-compliance-studio.mjs';

export function createComplianceStudioPublicRoutes(basePath = '/public/compliance-studio') {
  const snapshot = buildComplianceStudioSnapshot();
  const fixtures = createComplianceStudioFixtures();
  return [
    { id: 'compliance-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

