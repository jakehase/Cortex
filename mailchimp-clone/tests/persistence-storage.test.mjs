import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createTempDataDir } from './helpers.mjs';

const STORAGE_MODULE = new URL('../packages/app/storage.mjs', import.meta.url);

async function importStorage() {
  return import(`${STORAGE_MODULE.href}?t=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test('storage loads legacy root app.json and migrates newer collections', async (t) => {
  const dir = createTempDataDir('mailclone-persistence-');
  process.env.MAILCLONE_DATA_DIR = dir;

  const legacyPath = path.resolve(process.cwd(), 'app.json');
  const originalLegacy = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath, 'utf8') : null;
  fs.writeFileSync(legacyPath, JSON.stringify({ users: [{ id: 'u1' }], workspaces: [{ id: 'ws1' }], templates: [] }, null, 2));

  try {
    const { loadDb } = await importStorage();
    const db = loadDb();
    assert.equal(db.users.length, 1);
    assert.equal(db.workspaces.length, 1);
    assert.ok(Array.isArray(db.assetSnippets));
    assert.ok(Array.isArray(db.generatedSuggestions));
    assert.ok(Array.isArray(db.websitePages));
    assert.ok(Array.isArray(db.analyticsEvents));
    assert.ok(Array.isArray(db.mfaChallenges));
    assert.ok(Array.isArray(db.ssoSessions));
    assert.ok(Array.isArray(db.templates));
    assert.ok(db.templates.length > 0);
  } finally {
    delete process.env.MAILCLONE_DATA_DIR;
    if (originalLegacy == null) fs.rmSync(legacyPath, { force: true });
    else fs.writeFileSync(legacyPath, originalLegacy);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
});

test('storage persists atomically into workspace-state.json', async (t) => {
  const dir = createTempDataDir('mailclone-persistence-save-');
  process.env.MAILCLONE_DATA_DIR = dir;
  try {
    const { initDb, saveDb, dataPaths } = await importStorage();
    const db = initDb();
    db.users.push({ id: 'u2', email: 'owner@example.com' });
    saveDb(db);
    const persisted = JSON.parse(fs.readFileSync(dataPaths().dbPath, 'utf8'));
    assert.equal(persisted.users[0].email, 'owner@example.com');
    assert.equal(fs.existsSync(`${dataPaths().dbPath}.tmp`), false);
  } finally {
    delete process.env.MAILCLONE_DATA_DIR;
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
});
