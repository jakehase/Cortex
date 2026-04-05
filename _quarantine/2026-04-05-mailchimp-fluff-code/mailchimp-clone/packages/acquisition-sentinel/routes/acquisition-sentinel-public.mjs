import { buildAcquisitionSentinelSnapshot } from '../service-acquisition-sentinel.mjs';
import { createAcquisitionSentinelFixtures } from '../fixtures-acquisition-sentinel.mjs';

export function createAcquisitionSentinelPublicRoutes(basePath = '/public/acquisition-sentinel') {
  const snapshot = buildAcquisitionSentinelSnapshot();
  const fixtures = createAcquisitionSentinelFixtures();
  return [
    { id: 'acquisition-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

