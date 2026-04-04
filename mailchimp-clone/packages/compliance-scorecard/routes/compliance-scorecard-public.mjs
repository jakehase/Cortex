import { buildComplianceScorecardSnapshot } from '../service-compliance-scorecard.mjs';
import { createComplianceScorecardFixtures } from '../fixtures-compliance-scorecard.mjs';

export function createComplianceScorecardPublicRoutes(basePath = '/public/compliance-scorecard') {
  const snapshot = buildComplianceScorecardSnapshot();
  const fixtures = createComplianceScorecardFixtures();
  return [
    { id: 'compliance-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

