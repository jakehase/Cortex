import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetentionScorecardsSnapshot, createRetentionScorecardsDashboardRoutes, createRetentionScorecardsApiRoutes, createRetentionScorecardsOpsRoutes, createRetentionScorecardsPublicRoutes, summarizeRetentionScorecardsFixtures } from '../packages/retention-scorecards/index.mjs';

test('retention-scorecards package adds the last laddering architecture slice',()=>{const snapshot=buildRetentionScorecardsSnapshot('Final Ladder'); assert.equal(snapshot.summary.workspaceName,'Final Ladder'); assert.equal(snapshot.validation.ok,true); assert.equal(createRetentionScorecardsDashboardRoutes().length,3); assert.equal(createRetentionScorecardsApiRoutes().length,3); assert.equal(createRetentionScorecardsOpsRoutes().length,3); assert.equal(createRetentionScorecardsPublicRoutes().length,3); assert.equal(summarizeRetentionScorecardsFixtures().contacts,2);});
