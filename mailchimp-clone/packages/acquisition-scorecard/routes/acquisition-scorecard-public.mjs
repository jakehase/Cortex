import { buildAcquisitionScorecardSnapshot } from '../service-acquisition-scorecard.mjs';
import { createAcquisitionScorecardFixtures } from '../fixtures-acquisition-scorecard.mjs';

export function createAcquisitionScorecardPublicRoutes(basePath = '/public/acquisition-scorecard') {
  const snapshot = buildAcquisitionScorecardSnapshot();
  const fixtures = createAcquisitionScorecardFixtures();
  return [
    { id: 'acquisition-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

