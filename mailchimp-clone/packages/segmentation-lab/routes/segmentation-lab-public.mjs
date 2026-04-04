import { buildSegmentationLabSnapshot } from '../service-segmentation-lab.mjs';
import { createSegmentationLabFixtures } from '../fixtures-segmentation-lab.mjs';

export function createSegmentationLabPublicRoutes(basePath = '/public/segmentation-lab') {
  const snapshot = buildSegmentationLabSnapshot();
  const fixtures = createSegmentationLabFixtures();
  return [
    { id: 'segmentation-lab.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'segmentation-lab.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'segmentation-lab.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
