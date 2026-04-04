import { buildInboxMacrosSnapshot } from '../service-inbox-macros.mjs';

export function createInboxMacrosDashboardRoutes(basePath = '/inbox-macros') {
  const snapshot = buildInboxMacrosSnapshot();
  return [
    { id: 'inbox-macros.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'inbox-macros.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'inbox-macros.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
