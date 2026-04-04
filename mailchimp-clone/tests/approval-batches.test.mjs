import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalBatchesSnapshot, createApprovalBatchesDashboardRoutes, createApprovalBatchesApiRoutes, createApprovalBatchesOpsRoutes, createApprovalBatchesPublicRoutes, summarizeApprovalBatchesFixtures } from '../packages/approval-batches/index.mjs';

test('approval-batches package adds the last laddering architecture slice',()=>{const snapshot=buildApprovalBatchesSnapshot('Final Ladder'); assert.equal(snapshot.summary.workspaceName,'Final Ladder'); assert.equal(snapshot.validation.ok,true); assert.equal(createApprovalBatchesDashboardRoutes().length,3); assert.equal(createApprovalBatchesApiRoutes().length,3); assert.equal(createApprovalBatchesOpsRoutes().length,3); assert.equal(createApprovalBatchesPublicRoutes().length,3); assert.equal(summarizeApprovalBatchesFixtures().contacts,2);});
