import { buildAutomationStudioSnapshot, createAutomationStudioRouteSummary } from '../service-automation-studio.mjs';

export function createAutomationStudioDashboardRoutes(basePath = '/automation-studio') {
  const snapshot = buildAutomationStudioSnapshot();
  return [
    { id: 'automation-studio.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationStudioRouteSummary(snapshot) },
    { id: 'automation-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

