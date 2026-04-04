import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSenderRotationSnapshot, createSenderRotationDashboardRoutes, createSenderRotationApiRoutes, createSenderRotationOpsRoutes, createSenderRotationPublicRoutes, summarizeSenderRotationFixtures } from '../packages/sender-rotation/index.mjs';

test('sender-rotation package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildSenderRotationSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSenderRotationDashboardRoutes().length, 3);
  assert.equal(createSenderRotationApiRoutes().length, 3);
  assert.equal(createSenderRotationOpsRoutes().length, 3);
  assert.equal(createSenderRotationPublicRoutes().length, 3);
  assert.equal(summarizeSenderRotationFixtures().contacts, 2);
});

