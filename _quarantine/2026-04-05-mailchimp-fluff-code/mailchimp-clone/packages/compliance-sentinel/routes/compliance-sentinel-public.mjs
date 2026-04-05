import { buildComplianceSentinelSnapshot } from '../service-compliance-sentinel.mjs';
import { createComplianceSentinelFixtures } from '../fixtures-compliance-sentinel.mjs';

export function createComplianceSentinelPublicRoutes(basePath = '/public/compliance-sentinel') {
  const snapshot = buildComplianceSentinelSnapshot();
  const fixtures = createComplianceSentinelFixtures();
  return [
    { id: 'compliance-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

