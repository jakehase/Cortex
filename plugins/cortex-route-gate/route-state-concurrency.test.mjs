import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, 'route-state-concurrency-worker.mjs');
const raceWorkerPath = path.join(here, 'route-state-reclamation-race-worker.mjs');

function runWorker(targetPath, worker, iterations) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, targetPath, String(worker), String(iterations)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker ${worker} exited ${code}: ${stderr}`)));
  });
}

for (const stateName of [
  'prompt-fingerprints.json',
  'prompt-history.json',
  'creativity-retry.json',
  'creativity-metrics.json',
]) {
  test(`concurrent writers preserve every ${stateName} mutation`, async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-state-'));
    const targetPath = path.join(stateDir, stateName);
    const workers = 8;
    const iterations = 20;
    try {
      await Promise.all(Array.from({ length: workers }, (_, worker) => runWorker(targetPath, worker, iterations)));
      const state = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      assert.equal(state.entries.length, workers * iterations);
      assert.equal(new Set(state.entries).size, workers * iterations);
      assert.deepEqual(Object.values(state.counters).sort((a, b) => a - b), Array(workers).fill(iterations));
      assert.equal(fs.existsSync(`${targetPath}.lock`), false);
      assert.deepEqual(fs.readdirSync(stateDir).sort(), [stateName, `${stateName}.lock.guard`]);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

function spawnRaceWorker(targetPath, coordinationDir, role) {
  const child = spawn(process.execPath, [raceWorkerPath, targetPath, coordinationDir, role], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${role} exited ${code}: ${stderr}`)));
  });
  return { child, done };
}
async function waitFor(file, child, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (child.exitCode !== null) throw new Error(`worker exited ${child.exitCode} before ${path.basename(file)}`);
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path.basename(file)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function waitForGuardEntries(guard, count, child) {
  const deadline = Date.now() + 5_000;
  while (fs.readdirSync(guard).filter((name) => !name.endsWith('.tmp')).length < count) {
    if (child.exitCode !== null) throw new Error(`worker exited ${child.exitCode} before publishing its contender`);
    if (Date.now() >= deadline) throw new Error('timed out waiting for contender publication');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('three-process stale recovery never unlinks a replacement or overlaps transactions', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-reclamation-race-'));
  const targetPath = path.join(stateDir, 'state.json');
  const coordinationDir = path.join(stateDir, 'coordination');
  fs.mkdirSync(coordinationDir);
  fs.writeFileSync(`${targetPath}.lock`, JSON.stringify({
    version: 1, pid: 2_147_483_647, startIdentity: 'dead', token: 'stale-owner', createdAt: new Date(0).toISOString(),
  }));
  try {
    const first = spawnRaceWorker(targetPath, coordinationDir, 'first-reclaimer');
    await waitFor(path.join(coordinationDir, 'first-reclaimer.entered'), first.child);

    const replacement = spawnRaceWorker(targetPath, coordinationDir, 'replacement-writer');
    await waitForGuardEntries(`${targetPath}.lock.guard`, 2, replacement.child);
    const second = spawnRaceWorker(targetPath, coordinationDir, 'second-reclaimer');
    fs.writeFileSync(path.join(coordinationDir, 'first-reclaimer.release'), '');
    await first.done;
    await waitFor(path.join(coordinationDir, 'replacement-writer.entered'), replacement.child);
    assert.equal(second.child.exitCode, null, 'second contender must wait while replacement owns the lock');
    assert.equal(fs.existsSync(`${targetPath}.lock`), true, 'replacement lock must remain published');
    fs.writeFileSync(path.join(coordinationDir, 'replacement-writer.release'), '');
    await Promise.all([replacement.done, second.done]);

    const state = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.deepEqual(state.mutations, ['first-reclaimer', 'replacement-writer', 'second-reclaimer']);
    assert.equal(Number(fs.readFileSync(path.join(coordinationDir, 'max-concurrent'), 'utf8')), 1);
    assert.equal(Number(fs.readFileSync(path.join(coordinationDir, 'active'), 'utf8')), 0);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('a contender and published owner are recovered after process death', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-owner-death-'));
  const targetPath = path.join(stateDir, 'state.json');
  const coordinationDir = path.join(stateDir, 'coordination');
  fs.mkdirSync(coordinationDir);
  try {
    const doomed = spawnRaceWorker(targetPath, coordinationDir, 'doomed');
    await waitFor(path.join(coordinationDir, 'doomed.entered'), doomed.child);
    doomed.child.kill('SIGKILL');
    await assert.rejects(doomed.done, /exited null/);
    const survivor = spawnRaceWorker(targetPath, coordinationDir, 'second-reclaimer');
    await survivor.done;
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')).mutations, ['second-reclaimer']);
    assert.equal(fs.existsSync(`${targetPath}.lock`), false);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('a writer reclaims only its stale atomic-write temporaries', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-temp-reclamation-'));
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-route-temp-external-'));
  const targetPath = path.join(stateDir, 'state.json');
  const stale = `${targetPath}.2147483647.1.tmp`;
  const matchingSymlink = `${targetPath}.2147483647.2.tmp`;
  const otherTargetTemp = path.join(stateDir, 'other.json.2147483647.1.tmp');
  const similarName = `${targetPath}.not-a-pid.1.tmp`;
  const externalFile = path.join(externalDir, 'must-survive');
  try {
    fs.writeFileSync(stale, 'incomplete');
    fs.writeFileSync(otherTargetTemp, 'other');
    fs.writeFileSync(similarName, 'similar');
    fs.writeFileSync(externalFile, 'outside');
    fs.symlinkSync(externalFile, matchingSymlink);

    await runWorker(targetPath, 0, 1);

    assert.equal(fs.existsSync(stale), false);
    assert.throws(() => fs.lstatSync(matchingSymlink), { code: 'ENOENT' });
    assert.equal(fs.readFileSync(externalFile, 'utf8'), 'outside');
    assert.equal(fs.readFileSync(otherTargetTemp, 'utf8'), 'other');
    assert.equal(fs.readFileSync(similarName, 'utf8'), 'similar');
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')).entries, ['0:0']);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
});
