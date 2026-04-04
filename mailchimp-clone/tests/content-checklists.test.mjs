import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentChecklistsSnapshot, createContentChecklistsDashboardRoutes, createContentChecklistsApiRoutes, createContentChecklistsOpsRoutes, createContentChecklistsPublicRoutes, summarizeContentChecklistsFixtures } from '../packages/content-checklists/index.mjs';

test('content-checklists package adds one more late-closeout architecture slice',()=>{const snapshot=buildContentChecklistsSnapshot('Late Closeout'); assert.equal(snapshot.summary.workspaceName,'Late Closeout'); assert.equal(snapshot.validation.ok,true); assert.equal(createContentChecklistsDashboardRoutes().length,3); assert.equal(createContentChecklistsApiRoutes().length,3); assert.equal(createContentChecklistsOpsRoutes().length,3); assert.equal(createContentChecklistsPublicRoutes().length,3); assert.equal(summarizeContentChecklistsFixtures().contacts,2);});
