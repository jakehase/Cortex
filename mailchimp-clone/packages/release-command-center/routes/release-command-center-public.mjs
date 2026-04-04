import { buildReleaseCommandCenterSnapshot } from '../service-release-command-center.mjs';
import { createReleaseCommandCenterFixtures } from '../fixtures-release-command-center.mjs';

export function createReleaseCommandCenterPublicRoutes(basePath = '/public/release-command-center') { const snapshot = buildReleaseCommandCenterSnapshot(); const fixtures = createReleaseCommandCenterFixtures(); return [{ id: 'release-command-center.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'release-command-center.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'release-command-center.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

