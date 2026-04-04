import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateApprovalsSnapshot, createTemplateApprovalsDashboardRoutes, createTemplateApprovalsApiRoutes, createTemplateApprovalsOpsRoutes, createTemplateApprovalsPublicRoutes, summarizeTemplateApprovalsFixtures } from '../packages/template-approvals/index.mjs';

test('template-approvals package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildTemplateApprovalsSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createTemplateApprovalsDashboardRoutes().length, 3);
  assert.equal(createTemplateApprovalsApiRoutes().length, 3);
  assert.equal(createTemplateApprovalsOpsRoutes().length, 3);
  assert.equal(createTemplateApprovalsPublicRoutes().length, 3);
  assert.equal(summarizeTemplateApprovalsFixtures().contacts, 2);
});

