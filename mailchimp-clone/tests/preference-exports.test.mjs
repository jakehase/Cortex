import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreferenceExportsSnapshot, createPreferenceExportsDashboardRoutes, createPreferenceExportsApiRoutes, createPreferenceExportsOpsRoutes, createPreferenceExportsPublicRoutes, summarizePreferenceExportsFixtures } from '../packages/preference-exports/index.mjs';

test('preference-exports package adds one more late-closeout architecture slice',()=>{const snapshot=buildPreferenceExportsSnapshot('Late Closeout'); assert.equal(snapshot.summary.workspaceName,'Late Closeout'); assert.equal(snapshot.validation.ok,true); assert.equal(createPreferenceExportsDashboardRoutes().length,3); assert.equal(createPreferenceExportsApiRoutes().length,3); assert.equal(createPreferenceExportsOpsRoutes().length,3); assert.equal(createPreferenceExportsPublicRoutes().length,3); assert.equal(summarizePreferenceExportsFixtures().contacts,2);});
