import { buildBrandGovernanceSnapshot } from '../service-brand-governance.mjs';
import { createBrandGovernanceFixtures } from '../fixtures-brand-governance.mjs';

export function createBrandGovernancePublicRoutes(basePath = '/public/brand-governance') {
  const snapshot = buildBrandGovernanceSnapshot();
  const fixtures = createBrandGovernanceFixtures();
  return [
    { id: 'brand-governance.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'brand-governance.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'brand-governance.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
