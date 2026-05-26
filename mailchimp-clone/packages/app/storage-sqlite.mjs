import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export const SQLITE_SCHEMA_VERSION = 1;

function sqlitePath(paths) {
  return paths.sqlitePath || path.join(paths.dataDir, 'workspace-state.sqlite');
}

function openDatabase(paths) {
  const database = new DatabaseSync(sqlitePath(paths));
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  return database;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mailclone_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mailclone_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mailclone_records (
      collection TEXT NOT NULL,
      row_key TEXT NOT NULL,
      value TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      ordinal INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection, row_key)
    );
    CREATE INDEX IF NOT EXISTS idx_mailclone_records_collection_ordinal
      ON mailclone_records(collection, ordinal);
    CREATE TABLE IF NOT EXISTS mailclone_write_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_count INTEGER NOT NULL,
      record_count INTEGER NOT NULL,
      written_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.prepare('INSERT OR IGNORE INTO mailclone_migrations(version, name) VALUES (?, ?)').run(SQLITE_SCHEMA_VERSION, 'mailclone_sqlite_collections_v1');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasPersistedRows(database) {
  const recordCount = database.prepare('SELECT COUNT(*) AS count FROM mailclone_records').get().count;
  const metaCount = database.prepare('SELECT COUNT(*) AS count FROM mailclone_meta').get().count;
  return Number(recordCount) + Number(metaCount) > 0;
}

export function saveDbToSqlite(paths, dbObject = {}) {
  const database = openDatabase(paths);
  migrate(database);
  const collections = Object.entries(dbObject).filter(([, value]) => Array.isArray(value));
  const metaEntries = Object.entries(dbObject).filter(([, value]) => !Array.isArray(value));
  const recordCount = collections.reduce((sum, [, rows]) => sum + rows.length, 0);
  try {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('DELETE FROM mailclone_records').run();
    database.prepare('DELETE FROM mailclone_meta').run();
    const insertRecord = database.prepare('INSERT INTO mailclone_records(collection, row_key, value, version, ordinal) VALUES (?, ?, ?, ?, ?)');
    for (const [collection, rows] of collections) {
      const seenKeys = new Set();
      rows.forEach((row, index) => {
        const baseKey = row && typeof row === 'object' && row.id ? String(row.id) : `${collection}:${index}`;
        const rowKey = seenKeys.has(baseKey) ? `${baseKey}#${index}` : baseKey;
        seenKeys.add(rowKey);
        seenKeys.add(baseKey);
        const version = row && typeof row === 'object' && Number.isFinite(Number(row.version)) ? Number(row.version) : 1;
        insertRecord.run(collection, rowKey, JSON.stringify(row), version, index);
      });
    }
    const insertMeta = database.prepare('INSERT INTO mailclone_meta(key, value) VALUES (?, ?)');
    for (const [key, value] of metaEntries) insertMeta.run(key, JSON.stringify(value));
    database.prepare('INSERT INTO mailclone_write_ledger(collection_count, record_count) VALUES (?, ?)').run(collections.length, recordCount);
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    database.close();
  }
}

export function loadDbFromSqlite(paths, createSeedDb, legacyDb = null) {
  const database = openDatabase(paths);
  migrate(database);
  try {
    if (!hasPersistedRows(database)) {
      const seed = legacyDb ? clone(legacyDb) : createSeedDb();
      database.close();
      saveDbToSqlite(paths, seed);
      return seed;
    }

    const next = createSeedDb();
    const records = database.prepare('SELECT collection, value FROM mailclone_records ORDER BY collection ASC, ordinal ASC').all();
    for (const row of records) {
      next[row.collection] ||= [];
      next[row.collection].push(safeParse(row.value, {}));
    }
    const metaRows = database.prepare('SELECT key, value FROM mailclone_meta ORDER BY key ASC').all();
    for (const row of metaRows) next[row.key] = safeParse(row.value, null);
    return next;
  } finally {
    try { database.close(); } catch {}
  }
}

export function sqliteOperationalSummary(paths) {
  const database = openDatabase(paths);
  migrate(database);
  try {
    const migrationRows = database.prepare('SELECT version, name, applied_at AS appliedAt FROM mailclone_migrations ORDER BY version').all();
    const collectionRows = database.prepare('SELECT collection, COUNT(*) AS count FROM mailclone_records GROUP BY collection ORDER BY collection').all();
    const lastWrite = database.prepare('SELECT written_at AS writtenAt, collection_count AS collectionCount, record_count AS recordCount FROM mailclone_write_ledger ORDER BY id DESC LIMIT 1').get() || null;
    return {
      schemaVersion: SQLITE_SCHEMA_VERSION,
      sqlitePath: sqlitePath(paths),
      migrations: migrationRows,
      collections: collectionRows,
      collectionCount: collectionRows.length,
      recordCount: collectionRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
      lastWrite
    };
  } finally {
    database.close();
  }
}
