import { buildComplianceFoundrySnapshot } from '../service-compliance-foundry.mjs';
import { createComplianceFoundryFixtures } from '../fixtures-compliance-foundry.mjs';

export function createComplianceFoundryPublicRoutes(basePath = '/public/compliance-foundry') {
  const snapshot = buildComplianceFoundrySnapshot();
  const fixtures = createComplianceFoundryFixtures();
  return [
    { id: 'compliance-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

