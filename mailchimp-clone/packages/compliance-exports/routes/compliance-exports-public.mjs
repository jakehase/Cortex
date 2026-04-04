import { buildComplianceExportsSnapshot } from '../service-compliance-exports.mjs';
import { createComplianceExportsFixtures } from '../fixtures-compliance-exports.mjs';

export function createComplianceExportsPublicRoutes(basePath = '/public/compliance-exports') {
  const snapshot = buildComplianceExportsSnapshot();
  const fixtures = createComplianceExportsFixtures();
  return [
    { id: 'compliance-exports.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'compliance-exports.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'compliance-exports.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
