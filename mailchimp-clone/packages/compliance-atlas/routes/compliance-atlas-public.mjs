import { buildComplianceAtlasSnapshot } from '../service-compliance-atlas.mjs';
import { createComplianceAtlasFixtures } from '../fixtures-compliance-atlas.mjs';

export function createComplianceAtlasPublicRoutes(basePath = '/public/compliance-atlas') {
  const snapshot = buildComplianceAtlasSnapshot();
  const fixtures = createComplianceAtlasFixtures();
  return [
    { id: 'compliance-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

