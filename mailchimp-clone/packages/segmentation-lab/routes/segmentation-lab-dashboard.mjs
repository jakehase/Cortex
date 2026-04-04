import { buildSegmentationLabSnapshot } from '../service-segmentation-lab.mjs';

export function createSegmentationLabDashboardRoutes(basePath = '/segmentation-lab') {
  const snapshot = buildSegmentationLabSnapshot();
  return [
    { id: 'segmentation-lab.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'segmentation-lab.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'segmentation-lab.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
