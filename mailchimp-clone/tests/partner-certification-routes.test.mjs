import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartnerCertificationDashboardRoutes, createPartnerCertificationApiRoutes, createPartnerCertificationOpsRoutes, createPartnerCertificationPublicRoutes } from '../packages/partner-certification/index.mjs';

test('partner-certification routes honor custom base paths and stable ids', () => {
  const dashboard = createPartnerCertificationDashboardRoutes('/labs/partner-certification');
  const api = createPartnerCertificationApiRoutes('/api/labs/partner-certification');
  const ops = createPartnerCertificationOpsRoutes('/ops/labs/partner-certification');
  const pub = createPartnerCertificationPublicRoutes('/public/labs/partner-certification');
  assert.equal(dashboard[0].path, '/labs/partner-certification');
  assert.equal(api[0].path, '/api/labs/partner-certification/overview');
  assert.equal(ops[0].path, '/ops/labs/partner-certification/health');
  assert.equal(pub[0].path, '/public/labs/partner-certification');
  assert.match(dashboard[0].id, /partner\-certification/);
  assert.match(api[2].id, /partner\-certification/);
});

