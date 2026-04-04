import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateApprovalsDashboardRoutes, createTemplateApprovalsApiRoutes, createTemplateApprovalsOpsRoutes, createTemplateApprovalsPublicRoutes } from '../packages/template-approvals/index.mjs';

test('template-approvals routes honor custom base paths and stable ids', () => {
  const dashboard = createTemplateApprovalsDashboardRoutes('/labs/template-approvals');
  const api = createTemplateApprovalsApiRoutes('/api/labs/template-approvals');
  const ops = createTemplateApprovalsOpsRoutes('/ops/labs/template-approvals');
  const pub = createTemplateApprovalsPublicRoutes('/public/labs/template-approvals');
  assert.equal(dashboard[0].path, '/labs/template-approvals');
  assert.equal(api[0].path, '/api/labs/template-approvals/overview');
  assert.equal(ops[0].path, '/ops/labs/template-approvals/health');
  assert.equal(pub[0].path, '/public/labs/template-approvals');
  assert.match(dashboard[0].id, /template\-approvals/);
  assert.match(api[2].id, /template\-approvals/);
});

