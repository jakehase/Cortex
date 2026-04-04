import { createDataPipelineWorkspace, summarizeDataPipeline } from '../domain-data-pipeline.mjs';

export function createDataPipelineDashboardRoutes(basePath = '/data-pipeline') {
  const workspace = createDataPipelineWorkspace();
  const summary = summarizeDataPipeline(workspace);
  return [
    { id: 'data-pipeline.home', method: 'GET', path: basePath, summary },
    { id: 'data-pipeline.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'data-pipeline.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
