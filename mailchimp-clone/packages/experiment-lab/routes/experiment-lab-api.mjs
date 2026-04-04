import { createExperimentLabBrief, validateExperimentLabPlan } from '../domain-experiment-lab.mjs';

export function createExperimentLabApiRoutes(basePath = '/api/experiment-lab') {
  const sample = createExperimentLabBrief();
  return [
    { id: 'experiment-lab.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'experiment-lab.validate', method: 'POST', path: basePath + '/validate', validation: validateExperimentLabPlan(sample) }
  ];
}
