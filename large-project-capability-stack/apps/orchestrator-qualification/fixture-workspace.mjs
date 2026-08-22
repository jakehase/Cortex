import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function checksum(moduleId, lane, domain) {
  return Buffer.from(`${moduleId}:${lane}:${domain}`).toString('hex').slice(0, 16);
}

function writeModuleFiles(rootPath, fixture) {
  const moduleRoot = ensureDir(path.join(rootPath, fixture.moduleDir));
  const moduleChecksum = checksum(fixture.id, fixture.lane, fixture.domain);
  const manifest = {
    id: fixture.id,
    familyId: fixture.familyId,
    lane: fixture.lane,
    domain: fixture.domain,
    suffix: fixture.suffix,
    checksum: moduleChecksum
  };

  const source = `export const moduleMeta = ${JSON.stringify({
    id: fixture.id,
    familyId: fixture.familyId,
    lane: fixture.lane,
    domain: fixture.domain,
    suffix: fixture.suffix
  }, null, 2)};

export function moduleChecksum() {
  return '${moduleChecksum}';
}

export function describeModule() {
  return [moduleMeta.id, moduleMeta.lane, moduleMeta.domain].join(':');
}
`;

  const testScript = `import fs from 'node:fs';
import assert from 'node:assert/strict';
import { moduleMeta, moduleChecksum, describeModule } from './source.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
assert.equal(moduleMeta.id, manifest.id);
assert.equal(moduleMeta.familyId, manifest.familyId);
assert.equal(moduleMeta.lane, manifest.lane);
assert.equal(moduleMeta.domain, manifest.domain);
assert.equal(moduleChecksum(), manifest.checksum);
assert.ok(describeModule().includes(moduleMeta.id));
console.log(JSON.stringify({ ok: true, moduleId: manifest.id, verifier: 'tests' }));
`;

  const smokeScript = `import { describeModule } from './source.mjs';
const summary = describeModule();
if (!summary.includes(':')) throw new Error('invalid module summary');
console.log(JSON.stringify({ ok: true, verifier: 'smoke', summary }));
`;

  fs.writeFileSync(path.join(moduleRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), source);
  fs.writeFileSync(path.join(moduleRoot, 'test.mjs'), testScript);
  fs.writeFileSync(path.join(moduleRoot, 'smoke.mjs'), smokeScript);
  return manifest;
}

export function prepareLiveFixtureWorkspace({ rootPath, fixtures }) {
  ensureDir(rootPath);
  ensureDir(path.join(rootPath, 'modules'));
  const manifests = fixtures.map((fixture) => writeModuleFiles(rootPath, fixture));
  const workspaceManifest = {
    generatedAt: new Date().toISOString(),
    moduleCount: manifests.length,
    modules: manifests
  };
  fs.writeFileSync(path.join(rootPath, 'manifest.json'), JSON.stringify(workspaceManifest, null, 2));
  return workspaceManifest;
}
