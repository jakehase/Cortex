import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import { appShellEvidence, primaryArchitectureSurfaceMatrix } from '../packages/app/primary-architecture.mjs';

async function boot() {
  const dir = createTempDataDir('mailclone-primary-architecture-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, dir };
}

test('primary architecture route and API expose integrated production-slice evidence without claiming full clone', async () => {
  const { server, baseUrl, dir } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Architecture Admin',
      email: 'architecture@example.com',
      password: 'secret123',
      workspaceName: 'Architecture Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const page = await request(baseUrl, jar, '/architecture');
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Primary app architecture/);
    assert.match(html, /Primary client\/editor layer/);
    assert.match(html, /Primary database and migration model/);
    assert.match(html, /This production slice integrates primary app architecture signals but does not close strict 1:1 Mailchimp parity/);

    const assessment = await request(baseUrl, jar, '/architecture/assessment', { method: 'POST' });
    assert.equal(assessment.status, 302);
    assert.equal(assessment.headers.get('location'), '/architecture');
    assert.equal(server.state.db.primaryArchitectureAssessments.length, 1);

    const api = await request(baseUrl, jar, '/api/architecture');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.architecture.fidelity, 'production_slice');
    assert.equal(payload.architecture.matrixStatus, 'all_complete');
    assert.equal(payload.architecture.fullCloneStatus, 'not_full_clone');
    assert.equal(payload.architecture.surfaces.length, 6);
    assert.ok(payload.architecture.surfaces.every((surface) => surface.status === 'complete_for_production_slice'));

    const persistence = payload.architecture.surfaces.find((surface) => surface.id === 'primary_database_migration_model');
    assert.ok(persistence.evidence.schemaVersion >= 5);
    assert.ok(persistence.evidence.migrationLedger.length >= 5);

    const productionRuntime = payload.architecture.surfaces.find((surface) => surface.id === 'integrated_production_architecture_runtime');
    assert.equal(productionRuntime.evidence.matrixStatus, 'all_complete');
    assert.equal(productionRuntime.evidence.fullCloneStatus, 'not_full_clone');
    assert.ok(productionRuntime.evidence.lanes.some((lane) => lane.id === 'database_concurrency_runtime'));

    const serviceRuntime = payload.architecture.surfaces.find((surface) => surface.id === 'primary_service_runtime_observability');
    assert.equal(serviceRuntime.evidence.serviceRequests.total, 0);
    assert.ok(serviceRuntime.evidence.serviceBackends.some((entry) => entry.id === 'jobs'));

    const client = payload.architecture.surfaces.find((surface) => surface.id === 'primary_client_editor_layer');
    assert.equal(client.evidence.appShell.clientStateHandoff, true);
    assert.equal(client.evidence.appShell.builderPanelState, true);
    assert.equal(client.evidence.appShell.dropzoneHooks, true);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('primary architecture helpers derive matrix from live app shell and migrated storage state', async () => {
  const { server, dir } = await boot();
  try {
    const evidence = appShellEvidence();
    assert.equal(evidence.clientStateHandoff, true);
    assert.equal(evidence.builderPanelState, true);
    assert.equal(evidence.dropzoneHooks, true);
    assert.equal(evidence.styleHooks, true);

    const matrix = primaryArchitectureSurfaceMatrix(server.state, null);
    assert.equal(matrix.matrixStatus, 'all_complete');
    assert.equal(matrix.fullCloneStatus, 'not_full_clone');
    const persistence = matrix.surfaces.find((surface) => surface.id === 'primary_database_migration_model');
    assert.ok(persistence.evidence.schemaVersion >= 5);
    assert.ok(persistence.evidence.collectionInventory.some((entry) => entry.key === 'primaryArchitectureAssessments'));
    assert.ok(persistence.evidence.collectionInventory.some((entry) => entry.key === 'productionArchitectureAssessments'));
    assert.ok(persistence.evidence.collectionInventory.some((entry) => entry.key === 'serviceRequests'));

    const productionRuntime = matrix.surfaces.find((surface) => surface.id === 'integrated_production_architecture_runtime');
    assert.equal(productionRuntime.status, 'complete_for_production_slice');
    assert.equal(productionRuntime.evidence.matrixStatus, 'all_complete');
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
