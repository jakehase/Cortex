import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildBillingEntitlementsRuntimeSnapshot } from '../packages/app/domain-core.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('billing entitlement runtime records plan reconciliation, usage metering, trials, invoice collection, snapshots, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Billing Runtime Owner',
      email: 'billing-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Billing Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const billingLanding = await request(baseUrl, jar, '/billing');
    assert.match(await billingLanding.text(), /Billing entitlement runtime/);

    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    const workspace = server.state.db.workspaces[0];
    assert.equal(workspace.planId, 'growth');
    assert.equal(workspace.billing.entitlements.planId, 'growth');
    assert.ok(server.state.db.billingEntitlementEvents.some((entry) => entry.action === 'plan_changed'));

    await postForm(baseUrl, jar, '/billing/entitlements/reconcile', {});
    assert.ok(server.state.db.billingEntitlementEvents.some((entry) => entry.action === 'entitlements_reconciled'));

    await postForm(baseUrl, jar, '/billing/usage-meter', {
      metric: 'emails_sent',
      quantity: '12050'
    });
    const usage = server.state.db.billingUsageMeterEvents[0];
    assert.equal(usage.metric, 'emails_sent');
    assert.equal(usage.limit, 10000);
    assert.equal(usage.overageQuantity, 2050);

    await postForm(baseUrl, jar, '/billing/trial', { planId: 'pro' });
    assert.equal(workspace.billing.trial.planId, 'pro');
    assert.ok(server.state.db.billingTrialEvents.some((entry) => entry.action === 'trial_started'));

    await postForm(baseUrl, jar, '/billing/invoice-run', {});
    const invoiceEvent = server.state.db.billingInvoiceEvents.find((entry) => entry.action === 'invoice_collection_run_created');
    assert.ok(invoiceEvent);
    assert.equal(invoiceEvent.planId, 'growth');
    assert.equal(invoiceEvent.overageCents, 2050);
    assert.ok(workspace.billing.invoices.some((entry) => entry.collectionState === 'ready_to_collect'));

    const billingPage = await request(baseUrl, jar, '/billing');
    const billingHtml = await billingPage.text();
    assert.match(billingHtml, /Usage meter ledger/);
    assert.match(billingHtml, /Current plan semantics/);
    assert.match(billingHtml, /ready_to_collect/);

    const apiKey = workspace.apiKey;
    const runtimeApi = await request(baseUrl, null, '/api/billing/runtime', { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal(runtimeApi.status, 200);
    const runtimePayload = await runtimeApi.json();
    assert.equal(runtimePayload.ok, true);
    assert.equal(runtimePayload.billingRuntime.surfaceId, 'billing_entitlements_usage_runtime_layer');
    assert.equal(runtimePayload.billingRuntime.runtimeHealth.entitlementsReady, true);
    assert.equal(runtimePayload.billingRuntime.runtimeHealth.usageMeterReady, true);
    assert.equal(runtimePayload.billingRuntime.runtimeHealth.trialLifecycleReady, true);
    assert.equal(runtimePayload.billingRuntime.runtimeHealth.invoiceRunReady, true);

    const snapshotPage = await request(baseUrl, jar, '/billing/runtime/snapshot');
    assert.equal(snapshotPage.status, 200);
    assert.match(await snapshotPage.text(), /Billing entitlement runtime snapshot/);
    assert.equal(server.state.db.billingRuntimeSnapshots.length, 1);

    const snapshot = buildBillingEntitlementsRuntimeSnapshot(server.state, workspace.id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.usage.overageQuantity, 2050);
    assert.equal(snapshot.invoices.runtimeInvoiceEventCount >= 2, true);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
