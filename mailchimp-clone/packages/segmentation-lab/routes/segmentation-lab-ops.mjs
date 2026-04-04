import { buildSegmentationLabSnapshot, createSegmentationLabChecklist } from '../service-segmentation-lab.mjs';

export function createSegmentationLabOpsRoutes(basePath = '/ops/segmentation-lab') {
  const snapshot = buildSegmentationLabSnapshot();
  return [
    { id: 'segmentation-lab.ops.health', method: 'GET', path: basePath + '/health', checklist: createSegmentationLabChecklist(snapshot) },
    { id: 'segmentation-lab.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'segmentation-lab.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
