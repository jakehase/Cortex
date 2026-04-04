import { buildSegmentationLabSnapshot, createSegmentationLabApiDocument } from '../service-segmentation-lab.mjs';

export function createSegmentationLabApiRoutes(basePath = '/api/segmentation-lab') {
  const snapshot = buildSegmentationLabSnapshot();
  return [
    { id: 'segmentation-lab.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'segmentation-lab.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'segmentation-lab.api.document', method: 'GET', path: basePath + '/document', document: createSegmentationLabApiDocument(snapshot) }
  ];
}
