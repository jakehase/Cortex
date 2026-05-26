import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTempDataDir } from './helpers.mjs';
import { createAppState } from '../packages/app/storage.mjs';
import { createAccount, enqueueJob } from '../packages/app/domain-core.mjs';
import { createCampaign } from '../packages/app/domain-campaigns.mjs';
import { generateCampaignAiPackage } from '../packages/app/domain-current-product-ops.mjs';
import { installMarketplaceApp, syncMarketplaceInstallation } from '../packages/app/domain-integration-marketplace.mjs';
import { runJobs } from '../packages/app/jobs.mjs';
import { recordAnalyticsEvent } from '../packages/app/analytics-events.mjs';
import { primaryArchitectureSurfaceMatrix } from '../packages/app/primary-architecture.mjs';
import { serviceRuntimeSummary } from '../packages/app/service-backends.mjs';

function bootState() {
  const dir = createTempDataDir('mailclone-service-backed-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const state = createAppState();
  const { user, workspace } = createAccount(state, {
    name: 'Service Owner',
    email: `service-owner-${Date.now()}@example.com`,
    password: 'secret123',
    workspaceName: 'Service Runtime Lab'
  });
  return { dir, state, actor: { user, workspace } };
}

test('service-backed subsystem ledger records AI, analytics, integration provider, and delivery job handoffs', async () => {
  const { dir, state, actor } = bootState();
  try {
    const campaign = createCampaign(state, actor, 'Service-backed launch');

    const aiPackage = generateCampaignAiPackage(state, actor, campaign, { tone: 'clear', goal: 'activation' });
    assert.ok(aiPackage.providerRequestId);
    assert.ok(aiPackage.modelRunId);
    assert.equal(state.db.aiModelRuns.length, 1);

    const analyticsEvent = recordAnalyticsEvent(state, { type: 'campaign_open', workspaceId: actor.workspace.id, campaignId: campaign.id, recipientTotal: 10, count: 6 });
    assert.equal(analyticsEvent.count, 6);
    assert.equal(state.db.analyticsPipelineRuns.length, 1);

    const installation = installMarketplaceApp(state, actor, 'shopify');
    const sync = await syncMarketplaceInstallation(state, actor, installation);
    assert.equal(sync.providerResult.status, 'synced');
    assert.equal(state.db.integrationProviderCursors.length, 1);
    assert.equal(installation.providerCursor.installationId, installation.id);

    const job = enqueueJob(state, { type: 'send_test_campaign', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { campaignId: campaign.id, testEmail: 'qa@example.com' } });
    runJobs(state);
    assert.equal(job.status, 'completed');
    assert.equal(state.db.deliveryPipelineRuns.length, 1);

    const summary = serviceRuntimeSummary(state, actor.workspace.id);
    assert.equal(summary.requests.failed, 0);
    assert.ok(summary.requests.succeeded >= 4);
    assert.equal(summary.ai.modelRuns, 1);
    assert.equal(summary.integrations.cursors, 1);
    assert.equal(summary.analytics.pipelineRuns, 1);
    assert.equal(summary.delivery.pipelineRuns, 1);

    const matrix = primaryArchitectureSurfaceMatrix(state, actor);
    const serviceRuntime = matrix.surfaces.find((surface) => surface.id === 'primary_service_runtime_observability');
    const providerAi = matrix.surfaces.find((surface) => surface.id === 'primary_provider_ai_handoff');
    assert.equal(serviceRuntime.status, 'complete_for_production_slice');
    assert.ok(serviceRuntime.evidence.serviceRequests.succeeded >= 4);
    assert.equal(providerAi.evidence.integrationProviderCursors, 1);
    assert.equal(providerAi.evidence.aiModelRuns, 1);
  } finally {
    delete process.env.MAILCLONE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
