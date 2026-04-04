import { buildSegmentationQualitySnapshot } from '../service-segmentation-quality.mjs';
import { createSegmentationQualityFixtures } from '../fixtures-segmentation-quality.mjs';

export function createSegmentationQualityPublicRoutes(basePath = '/public/segmentation-quality') { const snapshot = buildSegmentationQualitySnapshot(); const fixtures = createSegmentationQualityFixtures(); return [{ id: 'segmentation-quality.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'segmentation-quality.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'segmentation-quality.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

