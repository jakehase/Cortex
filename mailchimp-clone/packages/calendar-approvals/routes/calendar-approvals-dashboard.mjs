import { buildCalendarApprovalsSnapshot } from '../service-calendar-approvals.mjs';

export function createCalendarApprovalsDashboardRoutes(basePath = '/calendar-approvals') { const snapshot = buildCalendarApprovalsSnapshot(); return [{ id: 'calendar-approvals.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'calendar-approvals.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'calendar-approvals.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

