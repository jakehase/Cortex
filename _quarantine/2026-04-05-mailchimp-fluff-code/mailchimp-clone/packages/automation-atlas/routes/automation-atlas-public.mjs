import { buildAutomationAtlasSnapshot } from '../service-automation-atlas.mjs';
import { createAutomationAtlasFixtures } from '../fixtures-automation-atlas.mjs';

export function createAutomationAtlasPublicRoutes(basePath = '/public/automation-atlas') {
  const snapshot = buildAutomationAtlasSnapshot();
  const fixtures = createAutomationAtlasFixtures();
  return [
    { id: 'automation-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

