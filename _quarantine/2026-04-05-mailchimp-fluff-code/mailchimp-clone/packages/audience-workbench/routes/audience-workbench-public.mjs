import { buildAudienceWorkbenchSnapshot } from '../service-audience-workbench.mjs';
import { createAudienceWorkbenchFixtures } from '../fixtures-audience-workbench.mjs';

export function createAudienceWorkbenchPublicRoutes(basePath = '/public/audience-workbench') {
  const snapshot = buildAudienceWorkbenchSnapshot();
  const fixtures = createAudienceWorkbenchFixtures();
  return [
    { id: 'audience-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

