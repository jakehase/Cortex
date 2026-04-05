import { buildAcquisitionAdvisorSnapshot } from '../service-acquisition-advisor.mjs';
import { createAcquisitionAdvisorFixtures } from '../fixtures-acquisition-advisor.mjs';

export function createAcquisitionAdvisorPublicRoutes(basePath = '/public/acquisition-advisor') {
  const snapshot = buildAcquisitionAdvisorSnapshot();
  const fixtures = createAcquisitionAdvisorFixtures();
  return [
    { id: 'acquisition-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

