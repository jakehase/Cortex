import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function importStorage() {
  return import(`../packages/app/storage.mjs?sqlite-proof=${Date.now()}-${Math.random()}`);
}

async function importServer() {
  return import(`../apps/web/server.mjs?sqlite-proof=${Date.now()}-${Math.random()}`);
}

test('sqlite storage engine persists workspace records with migration and write ledgers', async () => {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  process.env.MAILCLONE_STORAGE_ENGINE = 'sqlite';
  try {
    const { initDb, saveDb, loadDb, dataPaths, storageOperationalSummary, storageOperationalRuntimeEvidence } = await importStorage();
    const db = initDb();
    db.workspaces.push({ id: 'ws_sqlite', name: 'SQLite Proof', planId: 'pro', featureFlags: {}, settings: {}, billing: {} });
    db.contacts.push({ id: 'ct_sqlite', workspaceId: 'ws_sqlite', email: 'proof@example.com', status: 'subscribed' });
    db.jobs.push({ id: 'job_sqlite', workspaceId: 'ws_sqlite', status: 'queued' });

    saveDb(db);
    assert.equal(fs.existsSync(dataPaths().sqlitePath), true);

    const loaded = loadDb();
    assert.equal(loaded.workspaces.find((entry) => entry.id === 'ws_sqlite')?.name, 'SQLite Proof');
    assert.equal(loaded.contacts.find((entry) => entry.id === 'ct_sqlite')?.email, 'proof@example.com');

    const summary = storageOperationalSummary();
    assert.equal(summary.engine, 'sqlite');
    assert.equal(summary.sqlite.schemaVersion, 1);
    assert.ok(summary.sqlite.recordCount >= 3);
    assert.ok(summary.sqlite.migrations.some((entry) => entry.name === 'mailclone_sqlite_collections_v1'));
    assert.equal(summary.sqlite.lastWrite.recordCount >= 3, true);

    const evidence = storageOperationalRuntimeEvidence({ db: loaded });
    assert.equal(evidence.engine, 'sqlite');
    assert.equal(evidence.workflowStatus, 'persistence_queue_active');
    assert.equal(evidence.requestEvidence.engine, 'sqlite');
  } finally {
    delete process.env.MAILCLONE_DATA_DIR;
    delete process.env.MAILCLONE_STORAGE_ENGINE;
  }
});

test('authenticated app path can use sqlite persistence across server restarts', async () => {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  process.env.MAILCLONE_STORAGE_ENGINE = 'sqlite';
  let server;
  try {
    const { createServer } = await importServer();
    server = createServer();
    const address = await server.start({ port: 0 });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const jar = new CookieJar();

    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'SQLite Admin',
      email: 'sqlite@example.com',
      password: 'secret123',
      workspaceName: 'SQLite App Lab'
    }));
    const workspaceId = server.state.db.workspaces[0].id;
    await server.stop();
    server = null;

    const { createServer: createSecondServer } = await importServer();
    server = createSecondServer();
    const secondAddress = await server.start({ port: 0 });
    const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;
    const loginJar = new CookieJar();
    await followRedirect(secondBaseUrl, loginJar, await postForm(secondBaseUrl, loginJar, '/login', {
      email: 'sqlite@example.com',
      password: 'secret123'
    }));

    const page = await request(secondBaseUrl, loginJar, '/app');
    const html = await page.text();
    assert.match(html, /SQLite App Lab/);
    const systemPage = await request(secondBaseUrl, loginJar, '/admin/system');
    const systemHtml = await systemPage.text();
    assert.match(systemHtml, /Persistence data plane/);
    assert.match(systemHtml, /sqlite/);
    assert.match(systemHtml, /mailclone_sqlite_collections_v1/);
    assert.equal(server.state.db.workspaces.find((entry) => entry.id === workspaceId)?.name, 'SQLite App Lab');
  } finally {
    if (server) await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
    delete process.env.MAILCLONE_STORAGE_ENGINE;
  }
});
