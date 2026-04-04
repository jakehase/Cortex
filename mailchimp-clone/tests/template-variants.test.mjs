import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateVariantsSnapshot, createTemplateVariantsDashboardRoutes, createTemplateVariantsApiRoutes, createTemplateVariantsOpsRoutes, createTemplateVariantsPublicRoutes, summarizeTemplateVariantsFixtures } from '../packages/template-variants/index.mjs';

test('template-variants package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildTemplateVariantsSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createTemplateVariantsDashboardRoutes().length, 3);
  assert.equal(createTemplateVariantsApiRoutes().length, 3);
  assert.equal(createTemplateVariantsOpsRoutes().length, 3);
  assert.equal(createTemplateVariantsPublicRoutes().length, 3);
  assert.equal(summarizeTemplateVariantsFixtures().contacts, 2);
});

