import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSenderReputationSnapshot, createSenderReputationDashboardRoutes, createSenderReputationApiRoutes, createSenderReputationOpsRoutes, createSenderReputationPublicRoutes, summarizeSenderReputationFixtures } from '../packages/sender-reputation/index.mjs';

test('sender-reputation package adds the last laddering architecture slice',()=>{const snapshot=buildSenderReputationSnapshot('Final Ladder'); assert.equal(snapshot.summary.workspaceName,'Final Ladder'); assert.equal(snapshot.validation.ok,true); assert.equal(createSenderReputationDashboardRoutes().length,3); assert.equal(createSenderReputationApiRoutes().length,3); assert.equal(createSenderReputationOpsRoutes().length,3); assert.equal(createSenderReputationPublicRoutes().length,3); assert.equal(summarizeSenderReputationFixtures().contacts,2);});
