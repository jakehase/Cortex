import { buildSegmentationQualitySnapshot, createSegmentationQualityChecklist } from '../service-segmentation-quality.mjs';

export function createSegmentationQualityOpsRoutes(basePath = '/ops/segmentation-quality') { const snapshot = buildSegmentationQualitySnapshot(); return [{ id: 'segmentation-quality.ops.health', method: 'GET', path: basePath + '/health', checklist: createSegmentationQualityChecklist(snapshot) }, { id: 'segmentation-quality.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'segmentation-quality.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

