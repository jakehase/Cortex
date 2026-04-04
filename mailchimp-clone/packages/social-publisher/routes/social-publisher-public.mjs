import { buildSocialPublisherSnapshot } from '../service-social-publisher.mjs';
import { createSocialPublisherFixtures } from '../fixtures-social-publisher.mjs';

export function createSocialPublisherPublicRoutes(basePath = '/public/social-publisher') { const snapshot = buildSocialPublisherSnapshot(); const fixtures = createSocialPublisherFixtures(); return [{ id: 'social-publisher.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'social-publisher.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'social-publisher.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
