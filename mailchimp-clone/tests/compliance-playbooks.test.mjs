import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompliancePlaybooksSnapshot, createCompliancePlaybooksDashboardRoutes, createCompliancePlaybooksApiRoutes, createCompliancePlaybooksOpsRoutes, createCompliancePlaybooksPublicRoutes, summarizeCompliancePlaybooksFixtures } from '../packages/compliance-playbooks/index.mjs';

test('compliance-playbooks package pushes the continuation over another architecture tier',()=>{const snapshot=buildCompliancePlaybooksSnapshot('Final Anchor'); assert.equal(snapshot.summary.workspaceName,'Final Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createCompliancePlaybooksDashboardRoutes().length,3); assert.equal(createCompliancePlaybooksApiRoutes().length,3); assert.equal(createCompliancePlaybooksOpsRoutes().length,3); assert.equal(createCompliancePlaybooksPublicRoutes().length,3); assert.equal(summarizeCompliancePlaybooksFixtures().contacts,2);});
