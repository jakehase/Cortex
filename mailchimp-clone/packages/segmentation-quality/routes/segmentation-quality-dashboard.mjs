import { buildSegmentationQualitySnapshot } from '../service-segmentation-quality.mjs';

export function createSegmentationQualityDashboardRoutes(basePath = '/segmentation-quality') { const snapshot = buildSegmentationQualitySnapshot(); return [{ id: 'segmentation-quality.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'segmentation-quality.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'segmentation-quality.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

