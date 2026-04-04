import { buildAcquisitionConsoleSnapshot } from '../service-acquisition-console.mjs';
import { createAcquisitionConsoleFixtures } from '../fixtures-acquisition-console.mjs';

export function createAcquisitionConsolePublicRoutes(basePath = '/public/acquisition-console') {
  const snapshot = buildAcquisitionConsoleSnapshot();
  const fixtures = createAcquisitionConsoleFixtures();
  return [
    { id: 'acquisition-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

