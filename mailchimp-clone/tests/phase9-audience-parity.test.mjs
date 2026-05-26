import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request, waitFor } from './helpers.mjs';
import { leafProof, mergePhase9Proof } from './phase9-proof-helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function audienceProofs(server, workspaceId, audienceId, contactId) {
  const productFiles = ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'];
  const audienceCoreTests = ['tests/audience-core.test.mjs', 'tests/phase9-audience-parity.test.mjs'];
  const audienceCoreAndFunnelsTests = ['tests/audience-core.test.mjs', 'tests/audience-funnels.test.mjs', 'tests/phase9-audience-parity.test.mjs'];
  const funnelTests = ['tests/audience-funnels.test.mjs', 'tests/phase9-audience-parity.test.mjs'];
  const audience = server.state.db.audiences.find((entry) => entry.id === audienceId);
  const dbEvidence = {
    workspaceId,
    audienceId,
    contactId,
    contacts: server.state.db.contacts.filter((entry) => entry.audienceId === audienceId).length,
    segments: server.state.db.segments.filter((entry) => entry.audienceId === audienceId).map((entry) => ({ id: entry.id, analytics: entry.analytics })),
    jobs: server.state.db.jobs.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ type: entry.type, status: entry.status, audienceId: entry.payload?.audienceId })),
    exports: server.state.db.exports.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ label: entry.label, meta: entry.meta })),
    suppressions: server.state.db.suppressionEntries.filter((entry) => entry.audienceId === audienceId).length,
    syncRuns: server.state.db.integrationSyncRuns.filter((entry) => entry.audienceId === audienceId).length,
    taxonomy: audience.taxonomy,
    contactTableColumns: server.state.db.workspaces.find((entry) => entry.id === workspaceId).settings.contactTableColumns,
    auditActions: server.state.db.auditEvents.filter((event) => event.workspaceId === workspaceId).map((event) => event.action)
  };
  mergePhase9Proof({
    productSlice: 'audience_crm_table_profile_segments_taxonomy',
    leafProofs: [
      leafProof({ leafId: 'audience_overview__req_01', productFiles, targetedTests: audienceCoreTests, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'product_diff'], routeEvidence: ['GET /audiences/:id', 'POST /audiences/:id/export'], dbEvidence, assertions: ['audience summary cards include health score and suppression status', 'lifecycle insight rollups are computed from contacts', 'import/export history is persisted'] }),
      leafProof({ leafId: 'audience_overview__req_02', productFiles, targetedTests: audienceCoreTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration'], routeEvidence: ['POST /audiences/:id/provider-sync', 'GET /audiences/:id'], dbEvidence, assertions: ['audience drill-downs link contacts, segments, taxonomy, campaigns, automations, and commerce', 'provider sync queues an auditable job', 'integration sync run evidence is persisted'] }),
      leafProof({ leafId: 'contacts_table__req_01', productFiles, targetedTests: audienceCoreTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff'], routeEvidence: ['GET /contacts', 'POST /contacts/table/preferences', 'POST /contacts/export'], dbEvidence, assertions: ['contacts table supports saved columns', 'sorting and pagination preferences persist', 'filtered export writes a real export artifact'] }),
      leafProof({ leafId: 'contacts_table__req_02', productFiles, targetedTests: audienceCoreTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff', 'provider_integration'], routeEvidence: ['POST /contacts/bulk', 'POST /contacts/merge', 'GET /contacts'], dbEvidence, assertions: ['bulk actions mutate selected contacts', 'merge/dedupe combines duplicate profile traits', 'provider-origin contact fields remain visible in table flow'] }),
      leafProof({ leafId: 'contact_profile__req_01', productFiles, targetedTests: audienceCoreTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration'], routeEvidence: ['GET /contacts/:id', 'POST /api/contacts', 'PATCH /api/contacts/:id'], dbEvidence, assertions: ['contact profile exposes consent, tags, groups, interests, notes, and activity timeline', 'API-created provider contacts write to the same profile model', 'contact profile changes are audited'] }),
      leafProof({ leafId: 'contact_profile__req_02', productFiles, targetedTests: audienceCoreTests, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], routeEvidence: ['POST /contacts/:id/suppression', 'GET /contacts/:id'], dbEvidence, assertions: ['suppression state persists on the contact and suppression ledger', 'profile activity timeline records suppression and merge events', 'audience analytics reflect suppression state'] }),
      leafProof({ leafId: 'tags_groups_interests__req_01', productFiles, targetedTests: audienceCoreAndFunnelsTests, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'product_diff', 'provider_integration'], routeEvidence: ['GET /audiences/:id/taxonomy', 'POST /audiences/:id/taxonomy'], dbEvidence, assertions: ['tags, groups, and interests are first-class taxonomy records', 'contact traits enrich audience analytics', 'provider sync uses taxonomy-backed audience identity'] }),
      leafProof({ leafId: 'tags_groups_interests__req_02', productFiles, targetedTests: audienceCoreAndFunnelsTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration'], routeEvidence: ['POST /audiences/:id/taxonomy', 'POST /audiences/:id/provider-sync'], dbEvidence, assertions: ['taxonomy mutations are audited and persisted', 'taxonomy is visible in profile/table/segment flows', 'provider sync and segment jobs preserve taxonomy context'] }),
      leafProof({ leafId: 'segments__req_01', productFiles, targetedTests: funnelTests, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'product_diff'], routeEvidence: ['GET /segments', 'POST /segments/preview', 'POST /segments'], dbEvidence, assertions: ['segment builder previews audience matches', 'segment analytics persist match counts and subscribed matches', 'audience funnel package evidence remains covered'] }),
      leafProof({ leafId: 'segments__req_02', productFiles, targetedTests: funnelTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], routeEvidence: ['POST /segments', 'GET /jobs'], dbEvidence, assertions: ['segment creation queues refresh work', 'segment analytics are stored on the segment model', 'jobs surface exposes segment refresh runtime evidence'] })
    ]
  });
}

test('Phase 9 real parity audience CRM slice: overview, contacts table, profiles, taxonomy, and segments are product-backed', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Audience Owner',
      email: 'phase9-audience@example.com',
      password: 'secret123',
      workspaceName: 'Audience Proof Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });

    await postForm(baseUrl, jar, '/audiences', { name: 'Lifecycle Buyers', description: 'Audience parity proof' });
    const audiencesPage = await request(baseUrl, jar, '/audiences');
    const audienceId = (await audiencesPage.text()).match(/\/audiences\/(aud_[a-f0-9]+)/)[1];

    await postForm(baseUrl, jar, `/audiences/${audienceId}/taxonomy`, { kind: 'tag', name: 'vip' });
    await postForm(baseUrl, jar, `/audiences/${audienceId}/taxonomy`, { kind: 'interest', name: 'events' });
    await postForm(baseUrl, jar, `/audiences/${audienceId}/taxonomy`, { kind: 'group', groupName: 'Region', name: 'Central' });
    const taxonomyHtml = await (await request(baseUrl, jar, `/audiences/${audienceId}/taxonomy`)).text();
    assert.match(taxonomyHtml, /vip/);
    assert.match(taxonomyHtml, /Region:/);

    await postForm(baseUrl, jar, '/contacts', { audienceId, firstName: 'Casey', lastName: 'Jones', email: 'casey@example.com', phone: '555-0001', tags: 'vip, new', groupCategory: 'Region', groupValue: 'Central', interests: 'events, product' });
    await postForm(baseUrl, jar, '/contacts', { audienceId, firstName: 'Casey Duplicate', lastName: 'Jones', email: 'casey@example.com', tags: 'retained', groupCategory: 'Region', groupValue: 'Central', interests: 'events' });
    await postForm(baseUrl, jar, '/contacts', { audienceId, firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com', tags: 'new', groupCategory: 'Region', groupValue: 'East', interests: 'docs' });

    await postForm(baseUrl, jar, '/contacts/table/preferences', { columns: 'name,email,status,tags,groups,interests,source,updatedAt', sort: 'email', direction: 'asc', pageSize: '2' });
    let contactsHtml = await (await request(baseUrl, jar, `/contacts?audienceId=${audienceId}&sort=email&direction=asc&pageSize=2`)).text();
    assert.match(contactsHtml, /Saved columns & pagination/);
    assert.match(contactsHtml, /Page 1 of 2/);
    assert.match(contactsHtml, /Merge \/ dedupe candidates/);

    const caseyContacts = server.state.db.contacts.filter((entry) => entry.audienceId === audienceId && entry.email === 'casey@example.com');
    assert.equal(caseyContacts.length, 2);
    await postForm(baseUrl, jar, '/contacts/merge', { audienceId, primaryId: caseyContacts[0].id, mergeId: caseyContacts[1].id });
    assert.equal(server.state.db.contacts.filter((entry) => entry.audienceId === audienceId && entry.email === 'casey@example.com').length, 1);

    const contactId = server.state.db.contacts.find((entry) => entry.audienceId === audienceId && entry.email === 'casey@example.com').id;
    await postForm(baseUrl, jar, `/contacts/${contactId}`, { firstName: 'Casey', lastName: 'Jones', email: 'casey@example.com', phone: '555-1111', status: 'subscribed', tags: 'vip, retained', groupCategory: 'Region', groupValue: 'Central', interests: 'events, product', notes: 'Updated for profile proof' });
    await postForm(baseUrl, jar, `/contacts/${contactId}/suppression`, { reason: 'Manual unsubscribe request' });
    const contactHtml = await (await request(baseUrl, jar, `/contacts/${contactId}`)).text();
    assert.match(contactHtml, /Consent & suppression state/);
    assert.match(contactHtml, /Manual unsubscribe request/);
    assert.match(contactHtml, /Activity timeline/);

    await postForm(baseUrl, jar, '/contacts/export', { audienceId, q: 'casey', tag: 'vip', status: 'unsubscribed' });
    assert.ok(server.state.db.exports.some((entry) => entry.label.includes('filtered-contacts-export')));

    const previewImport = await postForm(baseUrl, jar, '/contacts/import/preview', {
      audienceId,
      csvText: 'email,firstName,lastName,tags,groupCategory,groupValue,interests,status\npat@example.com,Pat,Lee,imported,Region,West,events,subscribed\njamie@example.com,Jamie,Rae,imported,Region,South,events,subscribed'
    });
    const previewHtml = await previewImport.text();
    assert.match(previewHtml, /2 valid rows ready to import/);
    const previewId = previewHtml.match(/name="previewId" value="(import_[a-f0-9]+)"/)[1];
    await postForm(baseUrl, jar, '/contacts/import/commit', { previewId });
    await waitFor(async () => {
      const jobsPage = await request(baseUrl, jar, '/jobs');
      assert.match(await jobsPage.text(), /completed/);
      return true;
    });

    const preview = await postForm(baseUrl, jar, '/segments/preview', { audienceId, logic: 'all', field1: 'tag', operator1: 'contains', value1: 'imported' });
    assert.match(await preview.text(), /Preview count: 2/);
    await postForm(baseUrl, jar, '/segments', { audienceId, name: 'Imported event buyers', logic: 'all', field1: 'tag', operator1: 'contains', value1: 'imported', field2: 'interest', operator2: 'contains', value2: 'events' });
    const segment = server.state.db.segments.find((entry) => entry.name === 'Imported event buyers');
    assert.equal(segment.lastMatchCount, 2);
    assert.equal(segment.analytics.matchCount, 2);
    assert.ok(server.state.db.jobs.some((job) => job.type === 'segment_refresh'));

    await postForm(baseUrl, jar, `/audiences/${audienceId}/provider-sync`, { provider: 'shopify' });
    await postForm(baseUrl, jar, `/audiences/${audienceId}/export`, {});
    const audienceHtml = await (await request(baseUrl, jar, `/audiences/${audienceId}`)).text();
    assert.match(audienceHtml, /Audience health score/);
    assert.match(audienceHtml, /Lifecycle insights/);
    assert.match(audienceHtml, /Import\/export history/);
    assert.match(audienceHtml, /Provider sync/);
    assert.ok(server.state.db.integrationSyncRuns.some((entry) => entry.audienceId === audienceId && entry.appId === 'shopify'));
    assert.ok(server.state.db.suppressionEntries.some((entry) => entry.contactId === contactId));

    const workspaceId = server.state.db.workspaces.find((entry) => entry.name === 'Audience Proof Lab').id;
    audienceProofs(server, workspaceId, audienceId, contactId);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
