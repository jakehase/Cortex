import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildSettingsDomainsDeliverabilityRuntimeSnapshot } from '../packages/app/domain-deliverability-compliance.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('settings domains deliverability runtime records DNS, DMARC, warmup, dedicated IP, compliance review, snapshots, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Deliverability Runtime Owner',
      email: 'deliverability-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Deliverability Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Deliverability Runtime Owner',
      senderEmail: 'sender@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#2255aa',
      address: '100 Main Street'
    });
    await postForm(baseUrl, jar, '/settings/domains', { domain: 'example.com' });
    const domainId = server.state.db.workspaces[0].settings.domains[0].id;

    const firstPage = await request(baseUrl, jar, '/deliverability');
    const firstHtml = await firstPage.text();
    assert.match(firstHtml, /Settings domains deliverability runtime/);
    assert.match(firstHtml, /DNS authentication and DMARC/);

    await postForm(baseUrl, jar, '/deliverability/dns-check', { domainId });
    const dnsCheck = server.state.db.domainDnsCheckEvents[0];
    assert.equal(dnsCheck.domain, 'example.com');
    assert.equal(dnsCheck.status, 'pass');
    assert.equal(server.state.db.workspaces[0].settings.domains[0].authenticationStatus, 'authenticated');

    await postForm(baseUrl, jar, '/deliverability/dmarc', {
      domainId,
      policy: 'reject',
      alignmentMode: 'strict'
    });
    const dmarc = server.state.db.domainDmarcAlignmentEvents[0];
    assert.equal(dmarc.policy, 'reject');
    assert.equal(dmarc.aligned, true);

    await postForm(baseUrl, jar, '/deliverability/warmup', {
      stage: 'ramp_week_2',
      dailyCap: '1500',
      reputationBand: 'strong'
    });
    assert.equal(server.state.db.senderReputationWarmupEvents[0].dailyCap, 1500);

    await postForm(baseUrl, jar, '/deliverability/dedicated-ip', {
      poolId: 'pool-primary',
      reverseDnsStatus: 'aligned',
      assignedIpCount: '2'
    });
    assert.equal(server.state.db.dedicatedIpReadinessEvents[0].readiness, 'ready');

    await postForm(baseUrl, jar, '/deliverability/compliance-review', {});
    assert.ok(server.state.db.complianceReviewRuns[0].score >= 70);

    const deliverabilityPage = await request(baseUrl, jar, '/deliverability');
    const deliverabilityHtml = await deliverabilityPage.text();
    assert.match(deliverabilityHtml, /reject/);
    assert.match(deliverabilityHtml, /runtime snapshot/);
    assert.match(deliverabilityHtml, /authenticated/);

    const apiKey = server.state.db.workspaces[0].apiKey;
    const runtimeApi = await request(baseUrl, null, '/api/deliverability/runtime', { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal(runtimeApi.status, 200);
    const runtimePayload = await runtimeApi.json();
    assert.equal(runtimePayload.ok, true);
    assert.equal(runtimePayload.deliverabilityRuntime.surfaceId, 'settings_domains_deliverability_runtime_layer');
    assert.equal(runtimePayload.deliverabilityRuntime.runtimeHealth.dnsChecksReady, true);
    assert.equal(runtimePayload.deliverabilityRuntime.runtimeHealth.dmarcAlignmentReady, true);
    assert.equal(runtimePayload.deliverabilityRuntime.runtimeHealth.senderWarmupReady, true);
    assert.equal(runtimePayload.deliverabilityRuntime.runtimeHealth.dedicatedIpReady, true);
    assert.equal(runtimePayload.deliverabilityRuntime.runtimeHealth.complianceReviewReady, true);

    const snapshotPage = await request(baseUrl, jar, '/deliverability/runtime/snapshot');
    assert.equal(snapshotPage.status, 200);
    assert.match(await snapshotPage.text(), /Settings domains deliverability runtime snapshot/);
    assert.equal(server.state.db.deliverabilityRuntimeSnapshots.length, 1);

    const snapshot = buildSettingsDomainsDeliverabilityRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.dnsAuthentication.passCount, 1);
    assert.equal(snapshot.dmarcAlignment.alignedCount, 1);
    assert.equal(snapshot.dedicatedIpReadiness.readyCount, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
