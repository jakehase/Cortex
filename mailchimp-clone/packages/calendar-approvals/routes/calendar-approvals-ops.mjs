import { buildCalendarApprovalsSnapshot, createCalendarApprovalsChecklist } from '../service-calendar-approvals.mjs';

export function createCalendarApprovalsOpsRoutes(basePath = '/ops/calendar-approvals') { const snapshot = buildCalendarApprovalsSnapshot(); return [{ id: 'calendar-approvals.ops.health', method: 'GET', path: basePath + '/health', checklist: createCalendarApprovalsChecklist(snapshot) }, { id: 'calendar-approvals.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'calendar-approvals.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

