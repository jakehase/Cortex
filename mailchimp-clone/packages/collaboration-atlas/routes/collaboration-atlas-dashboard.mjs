import { buildCollaborationAtlasSnapshot, createCollaborationAtlasRouteSummary } from '../service-collaboration-atlas.mjs';

export function createCollaborationAtlasDashboardRoutes(basePath = '/collaboration-atlas') {
  const snapshot = buildCollaborationAtlasSnapshot();
  return [
    { id: 'collaboration-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationAtlasRouteSummary(snapshot) },
    { id: 'collaboration-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

