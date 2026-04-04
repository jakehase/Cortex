import { buildComplianceExchangeSnapshot } from '../service-compliance-exchange.mjs';
import { createComplianceExchangeFixtures } from '../fixtures-compliance-exchange.mjs';

export function createComplianceExchangePublicRoutes(basePath = '/public/compliance-exchange') {
  const snapshot = buildComplianceExchangeSnapshot();
  const fixtures = createComplianceExchangeFixtures();
  return [
    { id: 'compliance-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

