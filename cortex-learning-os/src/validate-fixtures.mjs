#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLOS_ROOT } from './paths.mjs';
import { validateRecord } from './contracts.mjs';

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target) : entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  });
}

function records(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (Array.isArray(parsed) ? parsed : [parsed]).map((record, index) => ({
    file: Array.isArray(parsed) ? `${file}#${index}` : file,
    validation: validateRecord(record)
  }));
}

const valid = files(path.join(CLOS_ROOT, 'fixtures/valid')).flatMap(records);
const invalid = files(path.join(CLOS_ROOT, 'fixtures/invalid')).flatMap(records);
const failures = [
  ...valid.filter((row) => !row.validation.ok).map((row) => ({ file: row.file, expected: 'valid', errors: row.validation.errors })),
  ...invalid.filter((row) => row.validation.ok).map((row) => ({ file: row.file, expected: 'invalid', errors: [] }))
];
const summary = {
  schemaVersion: 'cortex.learning_os.fixture_validation.v0',
  generatedAt: new Date().toISOString(),
  validFixtureCount: valid.length,
  invalidFixtureCount: invalid.length,
  failures,
  ok: failures.length === 0,
  truthBoundary: 'Learning Capsule v0 contract validation only; this does not prove domain expertise or a completed learning loop.'
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
