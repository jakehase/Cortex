import { createContentLibraryWorkspace, summarizeContentLibrary } from '../domain-content-library.mjs';

export function createContentLibraryDashboardRoutes(basePath = '/content-library') {
  const workspace = createContentLibraryWorkspace();
  const summary = summarizeContentLibrary(workspace);
  return [
    { id: 'content-library.home', method: 'GET', path: basePath, summary },
    { id: 'content-library.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'content-library.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
