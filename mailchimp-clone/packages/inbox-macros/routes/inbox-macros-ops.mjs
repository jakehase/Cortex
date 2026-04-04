import { buildInboxMacrosSnapshot, createInboxMacrosChecklist } from '../service-inbox-macros.mjs';

export function createInboxMacrosOpsRoutes(basePath = '/ops/inbox-macros') {
  const snapshot = buildInboxMacrosSnapshot();
  return [
    { id: 'inbox-macros.ops.health', method: 'GET', path: basePath + '/health', checklist: createInboxMacrosChecklist(snapshot) },
    { id: 'inbox-macros.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'inbox-macros.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
