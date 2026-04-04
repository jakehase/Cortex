import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceBudgetsSnapshot, createWorkspaceBudgetsDashboardRoutes, createWorkspaceBudgetsApiRoutes, createWorkspaceBudgetsOpsRoutes, createWorkspaceBudgetsPublicRoutes, summarizeWorkspaceBudgetsFixtures } from '../packages/workspace-budgets/index.mjs';

test('workspace-budgets package adds one more late-closeout architecture slice',()=>{const snapshot=buildWorkspaceBudgetsSnapshot('Late Closeout'); assert.equal(snapshot.summary.workspaceName,'Late Closeout'); assert.equal(snapshot.validation.ok,true); assert.equal(createWorkspaceBudgetsDashboardRoutes().length,3); assert.equal(createWorkspaceBudgetsApiRoutes().length,3); assert.equal(createWorkspaceBudgetsOpsRoutes().length,3); assert.equal(createWorkspaceBudgetsPublicRoutes().length,3); assert.equal(summarizeWorkspaceBudgetsFixtures().contacts,2);});
