import { buildCalendarApprovalsSnapshot, createCalendarApprovalsApiDocument } from '../service-calendar-approvals.mjs';

export function createCalendarApprovalsApiRoutes(basePath = '/api/calendar-approvals') { const snapshot = buildCalendarApprovalsSnapshot(); return [{ id: 'calendar-approvals.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'calendar-approvals.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'calendar-approvals.api.document', method: 'GET', path: basePath + '/document', document: createCalendarApprovalsApiDocument(snapshot) }]; }

