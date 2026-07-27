#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256File, sha256Text } from './hash.mjs';

export const PROOF_PREFLIGHT_SCHEMA = 'cortex.learning_os.lean_proof_preflight.v1';
export const PROOF_SOURCE_COMMIT = '97266f3f17e26dcecbe7029981b48555d618ec81';
export const PROOF_HOLE_MARKER = '{{CORTEX_PROOF_HOLE}}';
export const PROOF_TRUTH_BOUNDARY = 'Kernel acceptance proves only the exact formal statement under the pinned trusted imports. It does not establish understanding, broad mastery, novelty, a PhD, or any informal mathematical claim.';

export const DEFAULT_PROOF_KERNEL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../proof-kernel',
);
export const DEFAULT_LEAN_ROOT = path.join(
  DEFAULT_PROOF_KERNEL_ROOT,
  '.toolchain/lean-4.32.1-linux',
);

const EXPECTED_TOOLCHAIN_BYTES = 'leanprover/lean4:v4.32.1\n';
const EXPECTED_LAKEFILE_BYTES = [
  'name = "cortex-proof-kernel"',
  'version = "1.0.0"',
  'defaultTargets = ["ProofKernel"]',
  '',
  '[[lean_lib]]',
  'name = "ProofKernel"',
  '',
  '[[require]]',
  'name = "mathlib"',
  'git = "https://github.com/leanprover-community/mathlib4.git"',
  'rev = "520045ab14e26149ee970e2e617ca04b09bde5d6"',
  '',
].join('\n');
const EXPECTED_PRELUDE_BYTES = 'import Mathlib.Data.Nat.Basic\n';
const EXPECTED_REPRESENTATIVE_BYTES = [
  'import Mathlib.Data.Nat.Basic',
  '',
  'namespace CortexLearningOS.ProofKernel',
  '',
  'theorem representative_nat_add_zero (n : Nat) : n + 0 = n := by',
  '  simp',
  '',
  'end CortexLearningOS.ProofKernel',
  '',
].join('\n');

export const PINNED_LEAN_PROOF_IDENTITIES = Object.freeze({
  leanRelease: 'v4.32.1',
  leanToolchain: 'leanprover/lean4:v4.32.1',
  leanCommit: 'f054605aea4b840552cca2e725580bffd1e1b704',
  leanArchiveSha256: '57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50',
  leanArchitecture: 'x86_64-unknown-linux-gnu',
  mathlibTag: 'v4.32.1',
  mathlibCommit: '520045ab14e26149ee970e2e617ca04b09bde5d6',
});

export const PINNED_LEAN_PROOF_CONTEXT = Object.freeze({
  allowedImports: Object.freeze(['Mathlib.Data.Nat.Basic']),
  allowedImportsSha256: sha256Text(canonicalJson(['Mathlib.Data.Nat.Basic'])),
  leanToolchainSha256: sha256Text(EXPECTED_TOOLCHAIN_BYTES),
  lakefileSha256: sha256Text(EXPECTED_LAKEFILE_BYTES),
  preludeSha256: sha256Text(EXPECTED_PRELUDE_BYTES),
  representativeSha256: sha256Text(EXPECTED_REPRESENTATIVE_BYTES),
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function assertDirectory(target, label) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
}

function assertRegularFile(target, label, maximumBytes = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`${label} size is outside the allowed range`);
  }
  return stat;
}

function assertExecutable(target, label) {
  const stat = assertRegularFile(target, label, 256 * 1024 * 1024);
  if ((stat.mode & 0o111) === 0) throw new Error(`${label} is not executable`);
}

function checkExactFile(target, expectedBytes, label) {
  assertRegularFile(target, label, 1024 * 1024);
  const actual = fs.readFileSync(target, 'utf8');
  if (actual !== expectedBytes) throw new Error(`${label} does not match the immutable product bytes`);
}

function minimalEnvironment(extra = {}) {
  return {
    LANG: 'C',
    LC_ALL: 'C',
    ...extra,
  };
}

function runReadOnly(executable, argv, { cwd, env = {}, timeout = 10_000, maximumBytes = 1024 * 1024 } = {}) {
  const result = spawnSync(executable, argv, {
    cwd,
    env: minimalEnvironment(env),
    encoding: 'utf8',
    maxBuffer: maximumBytes,
    timeout,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${path.basename(executable)} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 500);
    throw new Error(`${path.basename(executable)} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function parseManifest(manifestPath) {
  assertRegularFile(manifestPath, 'Lake manifest', 4 * 1024 * 1024);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Lake manifest is not valid JSON: ${error.message}`);
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.packages)) {
    throw new Error('Lake manifest does not contain a packages array');
  }
  const names = new Set();
  for (const dependency of manifest.packages) {
    if (!isRecord(dependency)
        || typeof dependency.name !== 'string'
        || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(dependency.name)
        || names.has(dependency.name)) {
      throw new Error('Lake manifest contains an unsafe or duplicate package name');
    }
    names.add(dependency.name);
  }
  const mathlib = manifest.packages.find((dependency) => dependency.name === 'mathlib');
  if (!mathlib
      || mathlib.type !== 'git'
      || mathlib.rev !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit) {
    throw new Error('Lake manifest does not pin the exact mathlib commit');
  }
  return manifest;
}

function gitReadOnly(gitExecutable, mathlibRoot, argv) {
  return runReadOnly(gitExecutable, [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null',
    '-C', mathlibRoot,
    ...argv,
  ], {
    cwd: mathlibRoot,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
    },
  }).stdout.trim();
}

function deriveLeanPath(proofKernelRoot, manifest) {
  const roots = [];
  for (const dependency of manifest.packages) {
    const candidate = path.join(
      proofKernelRoot,
      '.lake/packages',
      dependency.name,
      '.lake/build/lib/lean',
    );
    if (!fs.existsSync(candidate)) continue;
    assertDirectory(candidate, `${dependency.name} Lean library`);
    roots.push(candidate);
  }
  const mathlibBuild = path.join(
    proofKernelRoot,
    '.lake/packages/mathlib/.lake/build/lib/lean',
  );
  if (!roots.includes(mathlibBuild)) throw new Error('mathlib compiled library is missing');
  const requiredOlean = path.join(mathlibBuild, 'Mathlib/Data/Nat/Basic.olean');
  assertRegularFile(requiredOlean, 'pinned Mathlib.Data.Nat.Basic olean', 512 * 1024 * 1024);
  return [...new Set(roots)].sort();
}

function absentResult(proofKernelRoot, leanRoot, errors) {
  return {
    schemaVersion: PROOF_PREFLIGHT_SCHEMA,
    status: 'absent',
    ready: false,
    identities: PINNED_LEAN_PROOF_IDENTITIES,
    proofKernelRoot,
    leanRoot,
    errors,
    truthBoundary: PROOF_TRUTH_BOUNDARY,
  };
}

function invalidResult(proofKernelRoot, leanRoot, errors) {
  return {
    schemaVersion: PROOF_PREFLIGHT_SCHEMA,
    status: 'invalid',
    ready: false,
    identities: PINNED_LEAN_PROOF_IDENTITIES,
    proofKernelRoot,
    leanRoot,
    errors,
    truthBoundary: PROOF_TRUTH_BOUNDARY,
  };
}

export function preflightLeanProofKernel({
  proofKernelRoot = DEFAULT_PROOF_KERNEL_ROOT,
  leanRoot = null,
} = {}) {
  const kernelRoot = path.resolve(proofKernelRoot);
  const selectedLeanRoot = path.resolve(
    leanRoot || path.join(kernelRoot, '.toolchain/lean-4.32.1-linux'),
  );
  const toolchainPath = path.join(kernelRoot, 'lean-toolchain');
  const lakefilePath = path.join(kernelRoot, 'lakefile.toml');
  const preludePath = path.join(kernelRoot, 'ProofKernel/Prelude.lean');
  const representativePath = path.join(kernelRoot, 'ProofKernel/Representative.lean');

  try {
    assertDirectory(kernelRoot, 'proof-kernel root');
    checkExactFile(toolchainPath, EXPECTED_TOOLCHAIN_BYTES, 'lean-toolchain');
    checkExactFile(lakefilePath, EXPECTED_LAKEFILE_BYTES, 'lakefile.toml');
    checkExactFile(preludePath, EXPECTED_PRELUDE_BYTES, 'proof prelude');
    checkExactFile(representativePath, EXPECTED_REPRESENTATIVE_BYTES, 'representative proof');
  } catch (error) {
    return invalidResult(kernelRoot, selectedLeanRoot, [error.message]);
  }

  if (!fs.existsSync(selectedLeanRoot)) {
    return absentResult(kernelRoot, selectedLeanRoot, ['pinned Lean installation is absent']);
  }

  const receiptPath = path.join(selectedLeanRoot, 'cortex-proof-kernel-installation.json');
  const leanExecutable = path.join(selectedLeanRoot, 'bin/lean');
  const lakeExecutable = path.join(selectedLeanRoot, 'bin/lake');
  const manifestPath = path.join(kernelRoot, 'lake-manifest.json');
  const mathlibRoot = path.join(kernelRoot, '.lake/packages/mathlib');
  if (!fs.existsSync(receiptPath)
      || !fs.existsSync(manifestPath)
      || !fs.existsSync(mathlibRoot)) {
    return absentResult(kernelRoot, selectedLeanRoot, ['pinned Lean/mathlib installation is incomplete']);
  }

  try {
    assertDirectory(selectedLeanRoot, 'Lean installation root');
    assertExecutable(leanExecutable, 'Lean executable');
    assertExecutable(lakeExecutable, 'Lake executable');
    assertRegularFile(receiptPath, 'Lean installation receipt', 64 * 1024);
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    } catch (error) {
      throw new Error(`Lean installation receipt is not valid JSON: ${error.message}`);
    }
    const receiptKeys = [
      'schemaVersion',
      'leanRelease',
      'leanToolchain',
      'leanCommit',
      'leanArchiveSha256',
      'leanExecutableSha256',
      'lakeExecutableSha256',
    ];
    if (!exactKeys(receipt, receiptKeys)
        || receipt.schemaVersion !== 'cortex.learning_os.lean_proof_installation.v1'
        || receipt.leanRelease !== PINNED_LEAN_PROOF_IDENTITIES.leanRelease
        || receipt.leanToolchain !== PINNED_LEAN_PROOF_IDENTITIES.leanToolchain
        || receipt.leanCommit !== PINNED_LEAN_PROOF_IDENTITIES.leanCommit
        || receipt.leanArchiveSha256 !== PINNED_LEAN_PROOF_IDENTITIES.leanArchiveSha256
        || !/^[0-9a-f]{64}$/.test(String(receipt.leanExecutableSha256 || ''))
        || !/^[0-9a-f]{64}$/.test(String(receipt.lakeExecutableSha256 || ''))) {
      throw new Error('Lean installation receipt is invalid or unpinned');
    }
    const leanExecutableSha256 = sha256File(leanExecutable);
    const lakeExecutableSha256 = sha256File(lakeExecutable);
    if (receipt.leanExecutableSha256 !== leanExecutableSha256
        || receipt.lakeExecutableSha256 !== lakeExecutableSha256) {
      throw new Error('pinned Lean/Lake executable digest mismatch');
    }

    const version = runReadOnly(leanExecutable, ['--version'], {
      cwd: kernelRoot,
    }).stdout.trim();
    const escapedCommit = PINNED_LEAN_PROOF_IDENTITIES.leanCommit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedArchitecture = PINNED_LEAN_PROOF_IDENTITIES.leanArchitecture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(
      `^Lean \\(version 4\\.32\\.1, ${escapedArchitecture}, commit ${escapedCommit}, Release\\)$`,
    );
    if (!versionPattern.test(version)) throw new Error(`unexpected Lean version output: ${version}`);

    const manifest = parseManifest(manifestPath);
    assertDirectory(mathlibRoot, 'mathlib root');
    assertDirectory(path.join(mathlibRoot, '.git'), 'mathlib Git metadata');
    const gitExecutable = '/usr/bin/git';
    assertExecutable(gitExecutable, 'Git executable');
    const mathlibHead = gitReadOnly(gitExecutable, mathlibRoot, ['rev-parse', 'HEAD']);
    const mathlibTagCommit = gitReadOnly(
      gitExecutable,
      mathlibRoot,
      ['rev-parse', `${PINNED_LEAN_PROOF_IDENTITIES.mathlibTag}^{commit}`],
    );
    if (mathlibHead !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit
        || mathlibTagCommit !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit) {
      throw new Error('mathlib HEAD/tag identity mismatch');
    }
    const trackedChanges = gitReadOnly(
      gitExecutable,
      mathlibRoot,
      ['status', '--porcelain=v1', '--untracked-files=no'],
    );
    if (trackedChanges !== '') throw new Error('mathlib tracked worktree is dirty');
    checkExactFile(
      path.join(mathlibRoot, 'lean-toolchain'),
      EXPECTED_TOOLCHAIN_BYTES,
      'mathlib lean-toolchain',
    );

    const leanPathEntries = deriveLeanPath(kernelRoot, manifest);
    const leanPath = leanPathEntries.join(path.delimiter);
    const representativeRun = runReadOnly(leanExecutable, [representativePath], {
      cwd: kernelRoot,
      env: { LEAN_PATH: leanPath },
      timeout: 30_000,
      maximumBytes: 1024 * 1024,
    });
    if (representativeRun.stderr !== '') {
      throw new Error(`representative proof emitted stderr: ${representativeRun.stderr.trim().slice(0, 500)}`);
    }

    return {
      schemaVersion: PROOF_PREFLIGHT_SCHEMA,
      status: 'ready',
      ready: true,
      identities: PINNED_LEAN_PROOF_IDENTITIES,
      context: PINNED_LEAN_PROOF_CONTEXT,
      proofKernelRoot: kernelRoot,
      leanRoot: selectedLeanRoot,
      leanExecutable,
      leanExecutableSha256,
      lakeExecutable,
      lakeExecutableSha256,
      leanVersion: version,
      mathlibRoot,
      mathlibHead,
      mathlibTagCommit,
      lakeManifestSha256: sha256File(manifestPath),
      leanPath,
      leanPathSha256: sha256Text(leanPath),
      errors: [],
      truthBoundary: PROOF_TRUTH_BOUNDARY,
    };
  } catch (error) {
    return invalidResult(kernelRoot, selectedLeanRoot, [error.message]);
  }
}
