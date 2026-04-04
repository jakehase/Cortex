import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalizationQaDashboardRoutes, createLocalizationQaApiRoutes, createLocalizationQaOpsRoutes, createLocalizationQaPublicRoutes } from '../packages/localization-qa/index.mjs';

test('localization-qa routes honor custom base paths and stable ids', () => {
  const dashboard = createLocalizationQaDashboardRoutes('/labs/localization-qa');
  const api = createLocalizationQaApiRoutes('/api/labs/localization-qa');
  const ops = createLocalizationQaOpsRoutes('/ops/labs/localization-qa');
  const pub = createLocalizationQaPublicRoutes('/public/labs/localization-qa');
  assert.equal(dashboard[0].path, '/labs/localization-qa');
  assert.equal(api[0].path, '/api/labs/localization-qa/overview');
  assert.equal(ops[0].path, '/ops/labs/localization-qa/health');
  assert.equal(pub[0].path, '/public/labs/localization-qa');
  assert.match(dashboard[0].id, /localization\-qa/);
  assert.match(api[2].id, /localization\-qa/);
});

