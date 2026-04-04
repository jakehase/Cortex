import { buildReleaseTrainSnapshot } from '../service-release-train.mjs';
import { createReleaseTrainFixtures } from '../fixtures-release-train.mjs';

export function createReleaseTrainPublicRoutes(basePath = '/public/release-train') { const snapshot = buildReleaseTrainSnapshot(); const fixtures = createReleaseTrainFixtures(); return [{ id: 'release-train.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'release-train.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'release-train.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
