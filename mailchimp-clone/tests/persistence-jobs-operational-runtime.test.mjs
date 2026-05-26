import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { enqueueJob } from '../packages/app/domain-core.mjs';
import { buildJobOperationalSnapshot, runJobs } from '../packages/app/jobs.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('persistence/jobs operational runtime records leases, heartbeats, snapshots, dead-letter requeue, and admin/API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Jobs Runtime Admin',
      email: 'jobs-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Jobs Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const actor = {
      user: server.state.db.users[0],
      workspace: server.state.db.workspaces[0],
      membership: server.state.db.memberships[0],
      memberships: server.state.db.memberships
    };
    const audience = server.state.db.audiences[0];
    const syncJob = enqueueJob(server.state, {
      type: 'audience_provider_sync',
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      payload: { audienceId: audience.id, provider: 'mailchimp-import-api', mode: 'bidirectional_contact_sync' }
    });

    await postForm(baseUrl, jar, '/jobs/run-once', {});
    runJobs(server.state, { workerId: 'test-worker' });
    assert.equal(syncJob.status, 'completed');
    assert.equal(audience.providerSync.lastProvider, 'mailchimp-import-api');
    assert.ok(server.state.db.jobQueueLeases.some((lease) => lease.jobId === syncJob.id && lease.status === 'released_completed'));
    assert.ok(server.state.db.jobOperationalSnapshots.length >= 1);
    assert.ok(server.state.db.jobServiceHeartbeats.some((heartbeat) => ['started', 'running'].includes(heartbeat.status)));

    server.state.db.jobs.unshift({
      id: 'job_terminal_bad',
      type: 'unsupported_terminal_job',
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      payload: { reason: 'prove dead letter operations' },
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runAt: new Date().toISOString(),
      maxAttempts: 1,
      attempts: 0,
      result: null
    });
    runJobs(server.state, { workerId: 'dead-letter-test-worker' });
    const deadLetter = server.state.db.jobDeadLetters.find((entry) => entry.jobId === 'job_terminal_bad');
    assert.ok(deadLetter);
    assert.match(deadLetter.error, /Unsupported job type/);
    assert.ok(server.state.db.jobQueueLeases.some((lease) => lease.jobId === 'job_terminal_bad' && lease.status === 'released_failed'));

    const operationsPage = await request(baseUrl, jar, '/jobs/operations');
    const operationsHtml = await operationsPage.text();
    assert.match(operationsHtml, /Operational queue contract/);
    assert.match(operationsHtml, /Worker leases/);
    assert.match(operationsHtml, /Dead letters/);
    assert.match(operationsHtml, /dead_letter_requeue_workflow/);

    const requeue = await postForm(baseUrl, jar, `/jobs/dead-letters/${deadLetter.id}/requeue`, {});
    assert.equal(requeue.status, 302);
    assert.ok(deadLetter.requeuedAt);
    const requeuedJob = server.state.db.jobs.find((job) => job.requeuedFromDeadLetterId === deadLetter.id);
    assert.equal(requeuedJob.status, 'pending');

    const api = await request(baseUrl, jar, '/api/jobs/operations');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.jobs.surfaceId, 'persistence_jobs_operational_runtime_layer');
    assert.ok(payload.jobs.evidenceContract.includes('dead_letter_records_and_requeues'));
    assert.ok(payload.jobs.queue.deadLetterCount >= 1);
    assert.ok(payload.jobs.leases.recent.length >= 2);

    const snapshot = buildJobOperationalSnapshot(server.state, actor.workspace.id);
    assert.equal(snapshot.controls.includes('worker_lease_and_heartbeat_ledger'), true);
    assert.ok(snapshot.queue.byStatus.completed >= 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
