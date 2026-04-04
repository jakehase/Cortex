import { buildPredictiveSegmentsSnapshot } from '../service-predictive-segments.mjs';
import { createPredictiveSegmentsFixtures } from '../fixtures-predictive-segments.mjs';

export function createPredictiveSegmentsPublicRoutes(basePath = '/public/predictive-segments') { const snapshot = buildPredictiveSegmentsSnapshot(); const fixtures = createPredictiveSegmentsFixtures(); return [{ id: 'predictive-segments.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'predictive-segments.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'predictive-segments.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

