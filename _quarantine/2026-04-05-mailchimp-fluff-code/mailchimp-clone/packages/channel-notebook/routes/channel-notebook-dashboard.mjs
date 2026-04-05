import { buildChannelNotebookSnapshot, createChannelNotebookRouteSummary } from '../service-channel-notebook.mjs';

export function createChannelNotebookDashboardRoutes(basePath = '/channel-notebook') {
  const snapshot = buildChannelNotebookSnapshot();
  return [
    { id: 'channel-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createChannelNotebookRouteSummary(snapshot) },
    { id: 'channel-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

