import { buildProfileEnrichmentSnapshot } from '../service-profile-enrichment.mjs';
import { createProfileEnrichmentFixtures } from '../fixtures-profile-enrichment.mjs';

export function createProfileEnrichmentPublicRoutes(basePath = '/public/profile-enrichment') { const snapshot = buildProfileEnrichmentSnapshot(); const fixtures = createProfileEnrichmentFixtures(); return [{ id: 'profile-enrichment.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'profile-enrichment.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'profile-enrichment.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

