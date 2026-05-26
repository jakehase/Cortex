import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTempDataDir } from './helpers.mjs';
import { createAppState } from '../packages/app/storage.mjs';
import { createAccount } from '../packages/app/domain-core.mjs';
import {
  beginProductionTransaction,
  buildProductionArchitectureReadiness,
  commitProductionTransaction,
  recordProviderSyncCheckpoint,
  recordQueueWorkerLease
} from '../packages/app/production-architecture.mjs';

function bootState() {
  const dir = createTempDataDir('mailclone-production-architecture-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const state = createAppState();
  const { user, workspace } = createAccount(state, {
    name: 'Runtime Owner',
    email: `runtime-owner-${Date.now()}@example.com`,
    password: 'secret123',
    workspaceName: 'Runtime Lab'
  });
  return { dir, state, actor: { user, workspace } };
}

test('integrated production architecture runtime exposes client, database, provider, queue, and security ledgers without claiming full clone', () => {
  const { dir, state, actor } = bootState();
  try {
    assert.ok(state.db.schemaVersion >= 5);
    assert.ok(state.db.schemaMigrations.some((entry) => entry.id === 'production_architecture_runtime'));

    const transaction = beginProductionTransaction(state, {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      collection: 'campaigns',
      operation: 'upsert_campaign_draft',
      expectedVersion: 1
    });
    commitProductionTransaction(state, transaction, { version: 2, changedCollections: ['campaigns'] });
    recordProviderSyncCheckpoint(state, {
      workspaceId: actor.workspace.id,
      providerConnectionId: 'provider-commerce-oauth',
      cursor: 'shopify:orders:42',
      objectCounts: { orders: 42 }
    });
    recordQueueWorkerLease(state, {
      workspaceId: actor.workspace.id,
      queue: 'delivery',
      jobId: 'job_123',
      workerId: 'worker-a'
    });

    const readiness = buildProductionArchitectureReadiness(state, actor);
    assert.equal(readiness.fidelity, 'production_slice');
    assert.equal(readiness.fullCloneStatus, 'not_full_clone');
    assert.equal(readiness.matrixStatus, 'all_complete');
    assert.ok(readiness.fullCloneBoundary.includes('not a Mailchimp 1:1 clone'));
    assert.ok(readiness.lanes.every((lane) => lane.status === 'complete_for_production_slice'));

    const dbLane = readiness.lanes.find((lane) => lane.id === 'database_concurrency_runtime');
    assert.equal(dbLane.evidence.transactionLedger, 1);
    assert.ok(dbLane.evidence.migrationIds.includes('production_architecture_runtime'));

    const providerLane = readiness.lanes.find((lane) => lane.id === 'external_provider_runtime');
    assert.equal(providerLane.evidence.checkpoints, 1);
    assert.ok(providerLane.evidence.connections.every((connection) => connection.secretMaterialStored === false));

    const queueLane = readiness.lanes.find((lane) => lane.id === 'queue_worker_runtime');
    assert.equal(queueLane.evidence.leases, 1);
  } finally {
    delete process.env.MAILCLONE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
