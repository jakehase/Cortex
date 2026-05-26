import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT, buildMailchimpContinuousFrontierRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('mailchimp continuous frontier runtime records official-surface runs, evidence events, snapshots, and API evidence', async () => {
  assert.equal(MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT.surfaceId, 'mailchimp_continuous_frontier_runtime_layer');
  assert.ok(MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT.controls.includes('frontier_surface_run_ledger'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Frontier Runtime Owner',
      email: 'frontier-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Frontier Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/ops/mailchimp-frontier/start', {
      surfaceId: 'mailchimp_frontier_email_marketing_campaigns_runtime_depth_runtime_layer',
      strictGap: 'email marketing campaigns parity: campaign shell exists, but Mailchimp-grade runtime depth remains open',
      officialSurface: 'Email marketing campaigns',
      officialLabels: 'Email Marketing,Email Builder,Campaign Manager',
      proofDimension: 'runtime_depth',
      workflowState: 'active_product_gap'
    });
    const run = server.state.db.mailchimpFrontierSurfaceRuns[0];
    assert.ok(run);
    assert.equal(run.officialSurface, 'Email marketing campaigns');
    assert.equal(run.proofDimension, 'runtime_depth');

    await postForm(baseUrl, jar, '/ops/mailchimp-frontier/evidence', {
      runId: run.id,
      eventType: 'workflow_evidence_recorded',
      evidenceLabel: 'normal app route and product model bound to official surface',
      evidenceStatus: 'observed',
      workflowState: 'evidence_recorded'
    });

    const runtimePage = await request(baseUrl, jar, '/ops/mailchimp-frontier');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Frontier runtime contract/);
    assert.match(runtimeHtml, /Email marketing campaigns/);

    const apiRuntime = await request(baseUrl, jar, '/api/ops/mailchimp-frontier/runtime');
    assert.equal(apiRuntime.status, 200);
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mailchimpFrontierRuntime.surfaceId, 'mailchimp_continuous_frontier_runtime_layer');
    assert.equal(payload.mailchimpFrontierRuntime.runCount, 1);
    assert.equal(payload.mailchimpFrontierRuntime.evidenceEventCount, 1);
    assert.equal(payload.mailchimpFrontierRuntime.distinctSurfaceCount, 1);
    assert.equal(payload.mailchimpFrontierRuntime.dimensionCounts.runtime_depth, 1);
    assert.equal(payload.mailchimpFrontierRuntime.runtimeHealth.runLedgerReady, true);
    assert.equal(payload.mailchimpFrontierRuntime.runtimeHealth.evidenceLedgerReady, true);
    assert.equal(payload.mailchimpFrontierRuntime.runtimeHealth.officialSurfaceAnchorReady, true);
    assert.ok(payload.mailchimpFrontierRuntime.evidenceContract.includes('frontier_runs_bind_to_official_mailchimp_surface_labels'));

    await postForm(baseUrl, jar, '/ops/mailchimp-frontier/snapshot', {});
    assert.equal(server.state.db.mailchimpFrontierRuntimeSnapshots.length, 1);
    const snapshot = buildMailchimpContinuousFrontierRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.recentRuns[0].evidenceEventIds[0], server.state.db.mailchimpFrontierEvidenceEvents[0].id);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
