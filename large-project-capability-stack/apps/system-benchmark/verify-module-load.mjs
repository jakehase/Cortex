#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const relPath = process.argv[2];
if (!relPath) {
  console.error('usage: node verify-module-load.mjs <relative-module-path>');
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), relPath);
const startedAt = Date.now();

try {
  await import(pathToFileURL(absPath).href);
  console.log(JSON.stringify({
    ok: true,
    modulePath: relPath,
    absolutePath: absPath,
    durationMs: Date.now() - startedAt
  }));
  process.exit(0);
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    modulePath: relPath,
    absolutePath: absPath,
    durationMs: Date.now() - startedAt,
    error: error?.message || String(error)
  }));
  process.exit(2);
}
