import { buildAgencyWorkspaceSnapshot } from '../service-agency-workspace.mjs';
import { createAgencyWorkspaceFixtures } from '../fixtures-agency-workspace.mjs';

export function createAgencyWorkspacePublicRoutes(basePath = '/public/agency-workspace') {
  const snapshot = buildAgencyWorkspaceSnapshot();
  const fixtures = createAgencyWorkspaceFixtures();
  return [
    { id: 'agency-workspace.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'agency-workspace.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'agency-workspace.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
