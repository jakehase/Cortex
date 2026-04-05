import { buildComplianceWorkbenchSnapshot } from '../service-compliance-workbench.mjs';
import { createComplianceWorkbenchFixtures } from '../fixtures-compliance-workbench.mjs';

export function createComplianceWorkbenchPublicRoutes(basePath = '/public/compliance-workbench') {
  const snapshot = buildComplianceWorkbenchSnapshot();
  const fixtures = createComplianceWorkbenchFixtures();
  return [
    { id: 'compliance-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

