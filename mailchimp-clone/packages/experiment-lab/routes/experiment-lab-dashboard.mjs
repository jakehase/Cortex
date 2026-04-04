import { createExperimentLabWorkspace, summarizeExperimentLab } from '../domain-experiment-lab.mjs';

export function createExperimentLabDashboardRoutes(basePath = '/experiment-lab') {
  const workspace = createExperimentLabWorkspace();
  const summary = summarizeExperimentLab(workspace);
  return [
    { id: 'experiment-lab.home', method: 'GET', path: basePath, summary },
    { id: 'experiment-lab.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'experiment-lab.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
