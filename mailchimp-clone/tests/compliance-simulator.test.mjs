import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceSimulatorSnapshot, createComplianceSimulatorDashboardRoutes, createComplianceSimulatorApiRoutes, createComplianceSimulatorOpsRoutes, createComplianceSimulatorPublicRoutes, summarizeComplianceSimulatorFixtures } from '../packages/compliance-simulator/index.mjs';

test('compliance-simulator package adds another closeout architecture slice',()=>{const snapshot=buildComplianceSimulatorSnapshot('Closeout Anchor'); assert.equal(snapshot.summary.workspaceName,'Closeout Anchor'); assert.equal(snapshot.validation.ok,true); assert.equal(createComplianceSimulatorDashboardRoutes().length,3); assert.equal(createComplianceSimulatorApiRoutes().length,3); assert.equal(createComplianceSimulatorOpsRoutes().length,3); assert.equal(createComplianceSimulatorPublicRoutes().length,3); assert.equal(summarizeComplianceSimulatorFixtures().contacts,2);});
