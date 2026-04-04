import { buildWorkspaceCatalogSnapshot } from '../service-workspace-catalog.mjs';
import { createWorkspaceCatalogFixtures } from '../fixtures-workspace-catalog.mjs';

export function createWorkspaceCatalogPublicRoutes(basePath = '/public/workspace-catalog') {
  const snapshot = buildWorkspaceCatalogSnapshot();
  const fixtures = createWorkspaceCatalogFixtures();
  return [
    { id: 'workspace-catalog.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'workspace-catalog.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'workspace-catalog.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
