import { buildCalendarApprovalsSnapshot } from '../service-calendar-approvals.mjs';
import { createCalendarApprovalsFixtures } from '../fixtures-calendar-approvals.mjs';

export function createCalendarApprovalsPublicRoutes(basePath = '/public/calendar-approvals') { const snapshot = buildCalendarApprovalsSnapshot(); const fixtures = createCalendarApprovalsFixtures(); return [{ id: 'calendar-approvals.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'calendar-approvals.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'calendar-approvals.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

