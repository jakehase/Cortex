import { buildComplianceAdvisorSnapshot } from '../service-compliance-advisor.mjs';
import { createComplianceAdvisorFixtures } from '../fixtures-compliance-advisor.mjs';

export function createComplianceAdvisorPublicRoutes(basePath = '/public/compliance-advisor') {
  const snapshot = buildComplianceAdvisorSnapshot();
  const fixtures = createComplianceAdvisorFixtures();
  return [
    { id: 'compliance-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

