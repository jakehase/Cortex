import { createDataPipelineBrief, validateDataPipelinePlan } from '../domain-data-pipeline.mjs';

export function createDataPipelineApiRoutes(basePath = '/api/data-pipeline') {
  const sample = createDataPipelineBrief();
  return [
    { id: 'data-pipeline.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'data-pipeline.validate', method: 'POST', path: basePath + '/validate', validation: validateDataPipelinePlan(sample) }
  ];
}
