import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarApprovalsSnapshot, createCalendarApprovalsDashboardRoutes, createCalendarApprovalsApiRoutes, createCalendarApprovalsOpsRoutes, createCalendarApprovalsPublicRoutes, summarizeCalendarApprovalsFixtures } from '../packages/calendar-approvals/index.mjs';

test('calendar-approvals package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildCalendarApprovalsSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCalendarApprovalsDashboardRoutes().length, 3);
  assert.equal(createCalendarApprovalsApiRoutes().length, 3);
  assert.equal(createCalendarApprovalsOpsRoutes().length, 3);
  assert.equal(createCalendarApprovalsPublicRoutes().length, 3);
  assert.equal(summarizeCalendarApprovalsFixtures().contacts, 2);
});

