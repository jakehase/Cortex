import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseAuditsSnapshot, createReleaseAuditsDashboardRoutes, createReleaseAuditsApiRoutes, createReleaseAuditsOpsRoutes, createReleaseAuditsPublicRoutes, summarizeReleaseAuditsFixtures } from '../packages/release-audits/index.mjs';

test('release-audits package adds another closeout architecture slice',()=>{const snapshot=buildReleaseAuditsSnapshot('Closeout Anchor'); assert.equal(snapshot.summary.workspaceName,'Closeout Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createReleaseAuditsDashboardRoutes().length,3); assert.equal(createReleaseAuditsApiRoutes().length,3); assert.equal(createReleaseAuditsOpsRoutes().length,3); assert.equal(createReleaseAuditsPublicRoutes().length,3); assert.equal(summarizeReleaseAuditsFixtures().contacts,2);});
