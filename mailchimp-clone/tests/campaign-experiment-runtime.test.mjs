import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildCampaignExperimentRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('campaign experimentation runtime records allocation, dynamic content, holdout, winner decisions, snapshots, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Experiment Runtime Owner',
      email: 'experiment-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Experiment Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Avery',
      lastName: 'Variant',
      email: 'avery@example.com',
      tags: 'vip,launch',
      interests: 'offers'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Morgan',
      lastName: 'Holdout',
      email: 'morgan@example.com',
      tags: 'prospect',
      interests: 'news'
    });

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Experiment Runtime Blast' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
      name: 'Experiment Runtime Blast',
      subject: 'Control subject',
      preheader: 'Control preheader',
      fromName: 'Experiment Runtime Owner',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });

    const experimentsPage = await request(baseUrl, jar, `/campaigns/${campaignId}/experiments`);
    assert.match(await experimentsPage.text(), /experimentation runtime evidence/i);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments`, {
      name: 'Subject and CTA experiment',
      winnerMetric: 'click_rate',
      dynamicRules: 'tag:vip,interest:offers,segment:launch',
      variantA: '40',
      variantB: '45',
      holdout: '15',
      variantBSubject: 'Variant subject',
      variantBPreheader: 'Variant preheader',
      variantBBody: 'Variant body for the winning candidate.'
    });
    const experiment = server.state.db.campaignExperiments.find((entry) => entry.campaignId === campaignId);
    assert.ok(experiment);
    assert.equal(server.state.db.campaignExperimentAllocationEvents.length, 1);
    assert.equal(server.state.db.campaignExperimentDynamicContentEvents.length, 1);
    assert.equal(server.state.db.campaignExperimentDynamicContentEvents[0].ruleCount, 3);
    assert.equal(server.state.db.campaignExperimentAllocationEvents[0].holdoutRecipients >= 1, true);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/run`, {});
    assert.equal(server.state.db.campaignExperimentHoldoutEvents.length, 1);
    assert.equal(server.state.db.campaignExperimentHoldoutEvents[0].compliant, true);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/promote`, {});
    assert.equal(server.state.db.campaignExperimentWinnerDecisions.length, 1);
    assert.equal(server.state.db.campaigns.find((entry) => entry.id === campaignId).experimentWinnerId, server.state.db.campaignExperimentWinnerDecisions[0].winnerVariantId);

    const runtimePage = await request(baseUrl, jar, '/campaigns/experiments/runtime');
    assert.match(await runtimePage.text(), /Experiment runtime contract/);

    const runtimeApi = await request(baseUrl, jar, '/api/campaigns/experiments/runtime');
    assert.equal(runtimeApi.status, 200);
    const payload = await runtimeApi.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.experimentRuntime.surfaceId, 'campaign_experimentation_decision_runtime_layer');
    assert.equal(payload.experimentRuntime.runtimeHealth.experimentModelReady, true);
    assert.equal(payload.experimentRuntime.runtimeHealth.allocationReady, true);
    assert.equal(payload.experimentRuntime.runtimeHealth.dynamicContentReady, true);
    assert.equal(payload.experimentRuntime.runtimeHealth.holdoutReady, true);
    assert.equal(payload.experimentRuntime.runtimeHealth.winnerDecisionReady, true);

    await postForm(baseUrl, jar, '/campaigns/experiments/runtime/snapshot', {});
    assert.equal(server.state.db.campaignExperimentRuntimeSnapshots.length, 1);
    const snapshot = buildCampaignExperimentRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.allocationEventCount, 1);
    assert.equal(snapshot.dynamicContentEventCount, 1);
    assert.equal(snapshot.holdoutEventCount, 1);
    assert.equal(snapshot.winnerDecisionCount, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
