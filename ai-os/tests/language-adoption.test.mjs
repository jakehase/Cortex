import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  AIOS_CANONICAL_COMPILER,
  AIOS_CANONICAL_LANGUAGE_VERSION,
  assertCanonicalAiosReady,
  compileCanonicalAiosSource,
} from '../packages/aios-language/canonical.mjs';
import * as packageFacade from '../packages/aios-language/index.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.dirname(root);
const source = `job adapterStatus {
  capability aios.status: read @internal;
  memory adapterArtifacts: persistent;
  step inspect uses kernel.artifact.status() reads [adapterArtifacts] -> status recover halt;
  verify status exists;
  truth adapterState: source="artifact-root", confidence="observed";
  rollback retain_artifacts;
}`;

function runNode(args, { cwd = root, expect = 0 } = {}) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  const text = (result.stdout || result.stderr).trim();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  assert.equal(result.status, expect, JSON.stringify({ args, status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
  return parsed;
}

test('canonical compiler emits one runtime-compatible internal job', () => {
  const result = compileCanonicalAiosSource(source, { sourceName: 'adapter-status.aios', tenantId: 'test', workspaceId: 'test' });
  assert.equal(result.ok, true);
  assert.equal(result.protocol, AIOS_CANONICAL_COMPILER);
  assert.equal(result.language.version, AIOS_CANONICAL_LANGUAGE_VERSION);
  assert.equal(result.boundary.externalWrites, false);
  assert.equal(result.boundary.runtimeReplacement, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].syscalls[0].op, 'kernel.artifact.status');
  assert.deepEqual(result.jobs[0].verifierContracts, ['status exists']);
  assert.equal(result.jobs[0].truthBoundary.claims[0].name, 'adapterState');
  assert.equal(result.jobs[0].recovery.strategy, 'retain_artifacts');
  assert.equal(assertCanonicalAiosReady().ok, true);
});

test('package facade exports the canonical compiler as the adoption entrypoint', () => {
  assert.equal(packageFacade.compileCanonicalAiosSource, compileCanonicalAiosSource);
  assert.equal(packageFacade.AIOS_CANONICAL_LANGUAGE_VERSION, AIOS_CANONICAL_LANGUAGE_VERSION);
});

test('canonical compiler fails closed for external effects', () => {
  const external = `job blocked {
    capability email.send: write @external;
    step send uses remote.email(message="hi") -> receipt recover halt;
    verify receipt exists;
    truth delivery: source="provider", confidence="observed";
    rollback halt;
  }`;
  const result = compileCanonicalAiosSource(external, { sourceName: 'blocked.aios' });
  assert.equal(result.ok, false);
  assert.equal(result.jobs.length, 0);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'AIOS_CANONICAL_EXTERNAL_EFFECT_BLOCKED'));
  assert.ok(result.diagnostics.some((entry) => entry.code === 'AIOS_CANONICAL_RUNTIME_ADAPTER_BLOCKED'));
});

test('canonical compiler requires capability, verifier, and truth declarations', () => {
  const incomplete = `job incomplete {
    step inspect uses kernel.artifact.status() -> status recover halt;
  }`;
  const result = compileCanonicalAiosSource(incomplete, { sourceName: 'incomplete.aios' });
  assert.equal(result.ok, false);
  const codes = new Set(result.diagnostics.map((entry) => entry.code));
  assert.ok(codes.has('AIOS_CANONICAL_CAPABILITY_REQUIRED'));
  assert.ok(codes.has('AIOS_CANONICAL_VERIFIER_REQUIRED'));
  assert.ok(codes.has('AIOS_CANONICAL_TRUTH_REQUIRED'));
});

test('CLI compiles canonical source and executes emitted job through the kernel', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-language-cli-'));
  const sourcePath = path.join(temp, 'status.aios');
  const artifactRoot = path.join(temp, 'artifacts');
  fs.writeFileSync(sourcePath, source);
  const compiled = runNode(['apps/aios-cli.mjs', 'compile', sourcePath, '--artifact-root', artifactRoot, '--workspace', 'test']);
  assert.equal(compiled.ok, true);
  assert.equal(compiled.status.state, 'ready');
  assert.equal(compiled.jobPaths.length, 1);
  assert.equal(fs.existsSync(compiled.proofPath), true);
  const boot = runNode(['apps/aios-cli.mjs', 'boot', '--artifact-root', artifactRoot]);
  assert.equal(boot.ok, true);
  const run = runNode(['apps/aios-cli.mjs', 'run', compiled.jobPaths[0], '--artifact-root', artifactRoot]);
  assert.equal(run.ok, true);
  const statusResult = run.syscallResults.find((entry) => entry.op === 'kernel.artifact.status');
  assert.equal(statusResult.ok, true);
  assert.equal(statusResult.output.bootOk, true);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('default OpenClaw adapter auto-compiles .aios source before execution', () => {
  const artifactRoot = fs.mkdtempSync(path.join(root, 'artifacts', 'openclaw-dogfood', 'language-adoption-test-'));
  const sourcePath = path.join(artifactRoot, 'status.aios');
  fs.writeFileSync(sourcePath, source);
  const boot = runNode(['scripts/aios-adapter.mjs', 'boot', '--artifact-root', artifactRoot], { cwd: workspaceRoot });
  assert.equal(boot.ok, true);
  const output = runNode([
    'scripts/aios-adapter.mjs', 'run', sourcePath,
    '--artifact-root', artifactRoot,
  ], { cwd: workspaceRoot });
  assert.equal(output.ok, true);
  assert.equal(output.languageCompilation.status.state, 'ready');
  assert.equal(fs.existsSync(output.languageCompilation.proofPath), true);
  assert.ok(output.syscallResults.some((entry) => entry.op === 'kernel.artifact.status' && entry.ok === true));
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});
