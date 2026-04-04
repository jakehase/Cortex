import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateVariantsDashboardRoutes, createTemplateVariantsApiRoutes, createTemplateVariantsOpsRoutes, createTemplateVariantsPublicRoutes } from '../packages/template-variants/index.mjs';

test('template-variants routes honor custom base paths and stable ids', () => {
  const dashboard = createTemplateVariantsDashboardRoutes('/labs/template-variants');
  const api = createTemplateVariantsApiRoutes('/api/labs/template-variants');
  const ops = createTemplateVariantsOpsRoutes('/ops/labs/template-variants');
  const pub = createTemplateVariantsPublicRoutes('/public/labs/template-variants');
  assert.equal(dashboard[0].path, '/labs/template-variants');
  assert.equal(api[0].path, '/api/labs/template-variants/overview');
  assert.equal(ops[0].path, '/ops/labs/template-variants/health');
  assert.equal(pub[0].path, '/public/labs/template-variants');
  assert.match(dashboard[0].id, /template\-variants/);
  assert.match(api[2].id, /template\-variants/);
});

