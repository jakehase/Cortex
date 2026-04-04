import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerCertificationSnapshot, createPartnerCertificationDashboardRoutes, createPartnerCertificationApiRoutes, createPartnerCertificationOpsRoutes, createPartnerCertificationPublicRoutes, summarizePartnerCertificationFixtures } from '../packages/partner-certification/index.mjs';

test('partner-certification package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildPartnerCertificationSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPartnerCertificationDashboardRoutes().length, 3);
  assert.equal(createPartnerCertificationApiRoutes().length, 3);
  assert.equal(createPartnerCertificationOpsRoutes().length, 3);
  assert.equal(createPartnerCertificationPublicRoutes().length, 3);
  assert.equal(summarizePartnerCertificationFixtures().contacts, 2);
});

