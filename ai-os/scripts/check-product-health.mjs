#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const roots = ['apps', 'packages', 'scripts'].filter((root) => fs.existsSync(path.join(repoRoot, root)));
const productFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'artifacts') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) productFiles.push(path.relative(repoRoot, full));
  }
};
for (const root of roots) walk(path.join(repoRoot, root));
productFiles.sort();
const syntaxFailures = [];
for (const file of productFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) syntaxFailures.push({ file, status: result.status, stderr: result.stderr.trim().split('\n').slice(0, 8).join('\n') });
}
const importFiles = productFiles.filter((file) => file.startsWith('packages/'));
const importFailures = [];
for (const file of importFiles) {
  try {
    await import(`${pathToFileURL(path.resolve(repoRoot, file)).href}?health=${Date.now()}`);
  } catch (error) {
    importFailures.push({ file, message: error?.message || String(error) });
  }
}
const report = {
  ok: syntaxFailures.length === 0 && importFailures.length === 0,
  checkedAt: new Date().toISOString(),
  syntaxCheckedFileCount: productFiles.length,
  importCheckedFileCount: importFiles.length,
  syntaxFailures,
  importFailures
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
