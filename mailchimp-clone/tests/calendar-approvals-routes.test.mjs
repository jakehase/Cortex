import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarApprovalsDashboardRoutes, createCalendarApprovalsApiRoutes, createCalendarApprovalsOpsRoutes, createCalendarApprovalsPublicRoutes } from '../packages/calendar-approvals/index.mjs';

test('calendar-approvals routes honor custom base paths and stable ids', () => {
  const dashboard = createCalendarApprovalsDashboardRoutes('/labs/calendar-approvals');
  const api = createCalendarApprovalsApiRoutes('/api/labs/calendar-approvals');
  const ops = createCalendarApprovalsOpsRoutes('/ops/labs/calendar-approvals');
  const pub = createCalendarApprovalsPublicRoutes('/public/labs/calendar-approvals');
  assert.equal(dashboard[0].path, '/labs/calendar-approvals');
  assert.equal(api[0].path, '/api/labs/calendar-approvals/overview');
  assert.equal(ops[0].path, '/ops/labs/calendar-approvals/health');
  assert.equal(pub[0].path, '/public/labs/calendar-approvals');
  assert.match(dashboard[0].id, /calendar\-approvals/);
  assert.match(api[2].id, /calendar\-approvals/);
});

