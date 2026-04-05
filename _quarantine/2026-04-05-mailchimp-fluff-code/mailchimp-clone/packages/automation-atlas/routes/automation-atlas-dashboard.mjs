import { buildAutomationAtlasSnapshot, createAutomationAtlasRouteSummary } from '../service-automation-atlas.mjs';

export function createAutomationAtlasDashboardRoutes(basePath = '/automation-atlas') {
  const snapshot = buildAutomationAtlasSnapshot();
  return [
    { id: 'automation-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationAtlasRouteSummary(snapshot) },
    { id: 'automation-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

