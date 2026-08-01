#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  deploymentBindingDigest,
  validateDeploymentBinding,
} from './deployment-identity.mjs';
import { sha256Bytes, sha256File, sha256Text } from './hash.mjs';
import {
  validatePhdTrustPolicy,
  verifyAuthorityAttestation,
} from './phd-trust.mjs';

export const PROOF_PREFLIGHT_SCHEMA = 'cortex.learning_os.lean_proof_preflight.v1';
export const PROOF_RUNTIME_PAYLOAD_SCHEMA = 'cortex.learning_os.proof_runtime_attestation_payload.v1';
export const PROOF_RUNTIME_EVIDENCE_SCHEMA = 'cortex.learning_os.proof_runtime_evidence.v1';
export const PROOF_RUNTIME_REQUEST_SCHEMA = 'cortex.learning_os.proof_runtime_attestation_request.v1';
export const PROOF_RUNTIME_AUTHORITY_PAYLOAD_SCHEMA = 'cortex.learning_os.proof_runtime_authority_payload.v1';
export const PROOF_HOLE_MARKER = '{{CORTEX_PROOF_HOLE}}';
export const PROOF_TRUTH_BOUNDARY = 'Kernel acceptance proves only the exact formal statement under the pinned trusted imports. It does not establish understanding, broad mastery, novelty, a PhD, or any informal mathematical claim.';
export const PROOF_RUNTIME_PRODUCT_ID = 'cortex-learning-os-proof-runtime';

const PRODUCT_PROOF_KERNEL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../proof-kernel',
);
const configuredRuntimeRoot = process.env.CLOS_PROOF_RUNTIME_ROOT
  ? path.resolve(process.env.CLOS_PROOF_RUNTIME_ROOT)
  : null;
export const DEFAULT_PROOF_KERNEL_ROOT = configuredRuntimeRoot === null
  ? PRODUCT_PROOF_KERNEL_ROOT
  : path.join(configuredRuntimeRoot, 'project');
export const DEFAULT_LEAN_ROOT = configuredRuntimeRoot === null
  ? path.join(PRODUCT_PROOF_KERNEL_ROOT, '.toolchain/lean-4.32.1-linux')
  : path.join(configuredRuntimeRoot, 'toolchain/lean-4.32.1-linux');

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
const EXPECTED_PRELUDE_BYTES = 'import Mathlib\n';
const EXPECTED_REPRESENTATIVE_BYTES = [
  'import Mathlib',
  '',
  'namespace CortexLearningOS.ProofKernel',
  '',
  'theorem representative_nat_add_zero (n : Nat) : n + 0 = n := by',
  '  simp',
  '',
  'end CortexLearningOS.ProofKernel',
  '',
].join('\n');
const EXPECTED_ROOT_MODULE_BYTES = [
  'import ProofKernel.Prelude',
  'import ProofKernel.Representative',
  '',
].join('\n');
const EXPECTED_LAKE_PACKAGE_NAMES = Object.freeze([
  'Cli',
  'LeanSearchClient',
  'Qq',
  'aesop',
  'batteries',
  'importGraph',
  'mathlib',
  'plausible',
  'proofwidgets',
]);
const EXPECTED_LEAN_RUNTIME_SYMLINKS = Object.freeze({
  'lib/libLLVM-22.so': 'libLLVM.so.22.1',
  'lib/libLLVM.so': 'libLLVM.so.22.1',
  'lib/libatomic.so': 'libatomic.so.1.2.0',
  'lib/libatomic.so.1': 'libatomic.so.1.2.0',
  'lib/libc++.so.1': 'libc++.so.1.0',
  'lib/libc++abi.so': 'libc++abi.so.1',
  'lib/libc++abi.so.1': 'libc++abi.so.1.0',
  'lib/libclang-cpp.so': 'libclang-cpp.so.22.1',
  'lib/libunwind.so': 'libunwind.so.1',
  'lib/libunwind.so.1': 'libunwind.so.1.0',
  'lib/libz.so': 'libz.so.1.2.11',
  'lib/libz.so.1': 'libz.so.1.2.11',
});

function assertFixtureOnlyBoolean(fixtureOnly) {
  if (typeof fixtureOnly !== 'boolean') {
    throw new Error('proof runtime fixtureOnly must be a boolean');
  }
}

const DIGEST = /^[0-9a-f]{64}$/;

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
  allowedImports: Object.freeze(['Mathlib']),
  allowedImportsSha256: sha256Text(canonicalJson(['Mathlib'])),
  leanToolchainSha256: sha256Text(EXPECTED_TOOLCHAIN_BYTES),
  lakefileSha256: sha256Text(EXPECTED_LAKEFILE_BYTES),
  preludeSha256: sha256Text(EXPECTED_PRELUDE_BYTES),
  representativeSha256: sha256Text(EXPECTED_REPRESENTATIVE_BYTES),
  rootModuleSha256: sha256Text(EXPECTED_ROOT_MODULE_BYTES),
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function canonicalBase64(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === value ? bytes : null;
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
  if (!fs.existsSync(target)) throw new Error(`${label} is absent`);
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
  const packageNames = [...names].sort();
  if (canonicalJson(packageNames) !== canonicalJson(EXPECTED_LAKE_PACKAGE_NAMES)) {
    throw new Error('Lake manifest package set differs from the exact product allowlist');
  }
  if (!mathlib
      || mathlib.type !== 'git'
      || mathlib.rev !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit) {
    throw new Error('Lake manifest does not pin the exact mathlib commit');
  }
  return manifest;
}

export function buildProofRuntimeAttestationPayload({
  proofKernelRoot = DEFAULT_PROOF_KERNEL_ROOT,
  leanRoot = null,
  deployment,
  trustPolicy,
  fixtureOnly = false,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  const kernelRoot = path.resolve(proofKernelRoot);
  const selectedLeanRoot = path.resolve(
    leanRoot || (proofKernelRoot === DEFAULT_PROOF_KERNEL_ROOT
      ? DEFAULT_LEAN_ROOT
      : path.join(kernelRoot, '.toolchain/lean-4.32.1-linux')),
  );
  const deploymentValidation = validateDeploymentBinding(deployment, {
    requiredContentIds: ['proof-registry', 'proof-runtime-product', 'trust-policy'],
  });
  if (!deploymentValidation.ok) {
    throw new Error(`proof runtime deployment binding is invalid: ${deploymentValidation.errors.join('; ')}`);
  }
  const trustValidation = validatePhdTrustPolicy(trustPolicy, {
    requireProduction: fixtureOnly !== true,
  });
  if (!trustValidation.ok) {
    throw new Error(`proof runtime trust policy is invalid: ${trustValidation.errors.join('; ')}`);
  }
  const trustPolicySha256 = sha256Text(canonicalJson(trustPolicy));
  if (deployment.contentDigests['trust-policy'] !== trustPolicySha256) {
    throw new Error('proof runtime deployment does not bind the exact trust policy');
  }
  assertDirectory(kernelRoot, 'proof-kernel root');
  assertDirectory(selectedLeanRoot, 'Lean installation root');
  const manifestPath = path.join(kernelRoot, 'lake-manifest.json');
  const manifest = parseManifest(manifestPath);
  const leanPathEntries = deriveLeanPath(kernelRoot, manifest);
  const leanRows = buildRuntimeContentManifest(selectedLeanRoot, {
    allowedSymlinks: EXPECTED_LEAN_RUNTIME_SYMLINKS,
  });
  const compiledRows = leanPathEntries.flatMap((root) => buildRuntimeContentManifest(root).map((row) => ({
    ...row,
    root: path.relative(kernelRoot, root).split(path.sep).join('/'),
  }))).sort((left, right) => (
    left.root.localeCompare(right.root) || left.path.localeCompare(right.path)
  ));
  const installationReceiptPath = path.join(
    selectedLeanRoot,
    'cortex-proof-kernel-installation.json',
  );
  assertRegularFile(installationReceiptPath, 'Lean installation receipt', 64 * 1024);
  const leanInstallation = JSON.parse(fs.readFileSync(installationReceiptPath, 'utf8'));
  const productManifest = [
    'lean-toolchain',
    'lakefile.toml',
    'ProofKernel.lean',
    'ProofKernel/Prelude.lean',
    'ProofKernel/Representative.lean',
  ].map((relative) => {
    const target = path.join(kernelRoot, relative);
    const stat = assertRegularFile(target, `proof runtime product file ${relative}`, 4 * 1024 * 1024);
    return {
      path: relative,
      bytes: stat.size,
      sha256: sha256File(target),
    };
  });
  const productManifestSha256 = sha256Text(canonicalJson(productManifest));
  if (deployment.contentDigests['proof-runtime-product'] !== productManifestSha256) {
    throw new Error('proof runtime product manifest differs from the deployment binding');
  }
  return {
    schemaVersion: PROOF_RUNTIME_PAYLOAD_SCHEMA,
    fixtureOnly: fixtureOnly === true,
    product: {
      productId: PROOF_RUNTIME_PRODUCT_ID,
      manifest: productManifest,
      manifestSha256: productManifestSha256,
    },
    deployment: structuredClone(deployment),
    deploymentSha256: deploymentBindingDigest(deployment),
    trust: {
      policyId: trustPolicy.policyId,
      boundaryId: trustPolicy.boundaryId,
      policySha256: trustPolicySha256,
    },
    toolchain: structuredClone(PINNED_LEAN_PROOF_IDENTITIES),
    trustedContext: structuredClone(PINNED_LEAN_PROOF_CONTEXT),
    leanInstallation,
    lakeManifest: manifest,
    leanRootManifest: leanRows,
    compiledDependenciesManifest: compiledRows,
  };
}

export function buildProofRuntimeAttestationRequest(payload) {
  const validation = validateRuntimePayloadStructure(payload, {
    expectedDeployment: payload?.deployment,
    allowFixture: payload?.fixtureOnly === true,
  });
  if (!validation.ok) {
    throw new Error(`proof runtime request payload is invalid: ${validation.errors.join('; ')}`);
  }
  const payloadBytes = Buffer.from(canonicalJson(payload), 'utf8');
  return {
    schemaVersion: PROOF_RUNTIME_REQUEST_SCHEMA,
    requestedCapability: 'proof_runtime',
    unsigned: true,
    selfAttestation: false,
    runtimePayloadBase64: payloadBytes.toString('base64'),
    runtimePayloadSha256: sha256Bytes(payloadBytes),
    requiredAttestationEncoding: 'canonical-json-without-trailing-newline',
    truthBoundary: 'This unsigned request describes exact local runtime, product, deployment, and trust bytes. It is not trusted until a separately protected proof-runtime authority validates and signs it.',
  };
}

function parseProofRuntimeRequestBytes(requestBytes) {
  const bytes = Buffer.isBuffer(requestBytes)
    ? Buffer.from(requestBytes)
    : Buffer.from(requestBytes || '');
  if (bytes.length < 2 || bytes.length > 64 * 1024 * 1024) {
    throw new Error('proof runtime request bytes are absent or oversized');
  }
  let request;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    request = JSON.parse(text);
  } catch (error) {
    throw new Error(`proof runtime request bytes are not strict JSON: ${error.message}`);
  }
  if (text !== canonicalJson(request)
      || !exactKeys(request, [
        'schemaVersion',
        'requestedCapability',
        'unsigned',
        'selfAttestation',
        'runtimePayloadBase64',
        'runtimePayloadSha256',
        'requiredAttestationEncoding',
        'truthBoundary',
      ])
      || request.schemaVersion !== PROOF_RUNTIME_REQUEST_SCHEMA
      || request.requestedCapability !== 'proof_runtime'
      || request.unsigned !== true
      || request.selfAttestation !== false
      || request.requiredAttestationEncoding !== 'canonical-json-without-trailing-newline'
      || request.truthBoundary
        !== 'This unsigned request describes exact local runtime, product, deployment, and trust bytes. It is not trusted until a separately protected proof-runtime authority validates and signs it.') {
    throw new Error('proof runtime request fields or canonical encoding are invalid');
  }
  const payloadBytes = canonicalBase64(request.runtimePayloadBase64);
  if (payloadBytes === null
      || request.runtimePayloadSha256 !== sha256Bytes(payloadBytes)) {
    throw new Error('proof runtime request payload bytes or digest are invalid');
  }
  let payload;
  try {
    const payloadText = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
    payload = JSON.parse(payloadText);
    if (payloadText !== canonicalJson(payload)) throw new Error('non-canonical payload bytes');
  } catch (error) {
    throw new Error(`proof runtime request payload is invalid: ${error.message}`);
  }
  return {
    bytes,
    request,
    requestSha256: sha256Bytes(bytes),
    payload,
  };
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
  const requiredOlean = path.join(mathlibBuild, 'Mathlib.olean');
  assertRegularFile(requiredOlean, 'pinned Mathlib olean', 512 * 1024 * 1024);
  return [...new Set(roots)].sort();
}

export function buildRuntimeContentManifest(root, {
  exclude = new Set(),
  allowedSymlinks = {},
} = {}) {
  const rows = [];
  const allowed = new Map(Object.entries(allowedSymlinks));
  const observedSymlinks = new Set();
  assertDirectory(root, 'runtime manifest root');
  const canonicalRoot = fs.realpathSync(root);
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (exclude.has(relative)) continue;
      if (entry.isSymbolicLink()) {
        const expectedTarget = allowed.get(relative);
        const observedTarget = fs.readlinkSync(target);
        if (expectedTarget === undefined || observedTarget !== expectedTarget) {
          throw new Error(`runtime manifest contains an unapproved symlink: ${relative}`);
        }
        const resolvedTarget = fs.realpathSync(target);
        const resolvedRelative = path.relative(canonicalRoot, resolvedTarget);
        if (resolvedRelative === '' || resolvedRelative === '..'
            || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) {
          throw new Error(`runtime manifest symlink escapes its root: ${relative}`);
        }
        const resolvedStat = fs.lstatSync(resolvedTarget);
        if (resolvedStat.isSymbolicLink() || !resolvedStat.isFile()) {
          throw new Error(`runtime manifest symlink target is not a regular file: ${relative}`);
        }
        observedSymlinks.add(relative);
        rows.push({
          path: relative,
          type: 'symlink',
          target: observedTarget,
          targetSha256: sha256File(resolvedTarget),
        });
      } else if (entry.isDirectory()) {
        walk(target);
      } else if (entry.isFile()) {
        const stat = fs.statSync(target);
        rows.push({
          path: relative,
          type: 'file',
          bytes: stat.size,
          executable: (stat.mode & 0o111) !== 0,
          sha256: sha256File(target),
        });
      } else {
        throw new Error(`runtime manifest contains a non-regular entry: ${relative}`);
      }
    }
  };
  walk(root);
  for (const relative of allowed.keys()) {
    if (!observedSymlinks.has(relative)) {
      throw new Error(`runtime manifest is missing an expected symlink: ${relative}`);
    }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function validateFileManifestRow(row, {
  label,
  allowSymlink = false,
  requireRoot = false,
} = {}) {
  if (row?.type === 'file') {
    const keys = requireRoot
      ? ['root', 'path', 'type', 'bytes', 'executable', 'sha256']
      : ['path', 'type', 'bytes', 'executable', 'sha256'];
    return exactKeys(row, keys)
      && (!requireRoot || typeof row.root === 'string')
      && typeof row.path === 'string'
      && row.path.length > 0
      && !path.isAbsolute(row.path)
      && !row.path.split('/').includes('..')
      && Number.isSafeInteger(row.bytes)
      && row.bytes >= 0
      && typeof row.executable === 'boolean'
      && /^[0-9a-f]{64}$/.test(String(row.sha256 || ''));
  }
  if (allowSymlink && row?.type === 'symlink') {
    return exactKeys(row, ['path', 'type', 'target', 'targetSha256'])
      && typeof row.path === 'string'
      && row.path.length > 0
      && !path.isAbsolute(row.path)
      && !row.path.split('/').includes('..')
      && typeof row.target === 'string'
      && row.target.length > 0
      && /^[0-9a-f]{64}$/.test(String(row.targetSha256 || ''));
  }
  return false;
}

function validateRuntimePayloadStructure(payload, {
  expectedDeployment = null,
  trustPolicy = null,
  allowFixture = false,
} = {}) {
  const errors = [];
  if (!exactKeys(payload, [
    'schemaVersion',
    'fixtureOnly',
    'product',
    'deployment',
    'deploymentSha256',
    'trust',
    'toolchain',
    'trustedContext',
    'leanInstallation',
    'lakeManifest',
    'leanRootManifest',
    'compiledDependenciesManifest',
  ])) {
    return { ok: false, errors: ['proof runtime attestation payload fields are incomplete or unknown'] };
  }
  if (payload.schemaVersion !== PROOF_RUNTIME_PAYLOAD_SCHEMA) {
    errors.push('invalid proof runtime attestation payload schemaVersion');
  }
  if (typeof payload.fixtureOnly !== 'boolean'
      || (payload.fixtureOnly === true && allowFixture !== true)) {
    errors.push('fixture-only proof runtime payload is forbidden at this boundary');
  }
  const productPaths = [
    'lean-toolchain',
    'lakefile.toml',
    'ProofKernel.lean',
    'ProofKernel/Prelude.lean',
    'ProofKernel/Representative.lean',
  ];
  if (!exactKeys(payload.product, ['productId', 'manifest', 'manifestSha256'])
      || payload.product.productId !== PROOF_RUNTIME_PRODUCT_ID
      || !Array.isArray(payload.product.manifest)
      || payload.product.manifest.length !== productPaths.length
      || payload.product.manifest.some((row, index) => (
        !exactKeys(row, ['path', 'bytes', 'sha256'])
        || row.path !== productPaths[index]
        || !Number.isSafeInteger(row.bytes) || row.bytes < 1
        || !/^[0-9a-f]{64}$/.test(String(row.sha256 || ''))
      ))
      || payload.product.manifestSha256
        !== sha256Text(canonicalJson(payload.product.manifest))
      || payload.product.manifestSha256
        !== payload.deployment?.contentDigests?.['proof-runtime-product']) {
    errors.push('proof runtime product manifest is incomplete or invalid');
  }
  const deploymentValidation = validateDeploymentBinding(payload.deployment, {
    requiredContentIds: ['proof-registry', 'proof-runtime-product', 'trust-policy'],
  });
  if (!deploymentValidation.ok
      || (payload.fixtureOnly === false
        && payload.deployment?.schemaVersion
          !== APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA)
      || payload.deploymentSha256 !== (() => {
        try { return deploymentBindingDigest(payload.deployment); } catch { return null; }
      })()) {
    errors.push('proof runtime deployment binding is invalid');
  }
  if (expectedDeployment !== null
      && canonicalJson(payload.deployment) !== canonicalJson(expectedDeployment)) {
    errors.push('proof runtime deployment binding was substituted');
  }
  if (!exactKeys(payload.trust, ['policyId', 'boundaryId', 'policySha256'])
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(payload.trust.policyId || ''))
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(payload.trust.boundaryId || ''))
      || !/^[0-9a-f]{64}$/.test(String(payload.trust.policySha256 || ''))
      || payload.trust.policySha256 !== payload.deployment?.contentDigests?.['trust-policy']) {
    errors.push('proof runtime trust binding is invalid');
  }
  if (trustPolicy !== null
      && (payload.trust.policyId !== trustPolicy.policyId
        || payload.trust.boundaryId !== trustPolicy.boundaryId
        || payload.trust.policySha256 !== sha256Text(canonicalJson(trustPolicy)))) {
    errors.push('proof runtime trust policy binding was substituted');
  }
  if (canonicalJson(payload.toolchain) !== canonicalJson(PINNED_LEAN_PROOF_IDENTITIES)
      || canonicalJson(payload.trustedContext) !== canonicalJson(PINNED_LEAN_PROOF_CONTEXT)) {
    errors.push('proof runtime pinned toolchain or trusted-context binding mismatch');
  }
  const installationKeys = [
    'schemaVersion',
    'leanRelease',
    'leanToolchain',
    'leanCommit',
    'leanArchiveSha256',
    'leanExecutableSha256',
    'lakeExecutableSha256',
  ];
  if (!exactKeys(payload.leanInstallation, installationKeys)
      || payload.leanInstallation.schemaVersion
        !== 'cortex.learning_os.lean_proof_installation.v1'
      || payload.leanInstallation.leanRelease !== PINNED_LEAN_PROOF_IDENTITIES.leanRelease
      || payload.leanInstallation.leanToolchain !== PINNED_LEAN_PROOF_IDENTITIES.leanToolchain
      || payload.leanInstallation.leanCommit !== PINNED_LEAN_PROOF_IDENTITIES.leanCommit
      || payload.leanInstallation.leanArchiveSha256
        !== PINNED_LEAN_PROOF_IDENTITIES.leanArchiveSha256
      || !/^[0-9a-f]{64}$/.test(String(payload.leanInstallation.leanExecutableSha256 || ''))
      || !/^[0-9a-f]{64}$/.test(String(payload.leanInstallation.lakeExecutableSha256 || ''))) {
    errors.push('proof runtime exact Lean installation manifest is invalid');
  }
  const packages = payload.lakeManifest?.packages;
  const packageNames = Array.isArray(packages)
    ? packages.map((row) => row?.name).sort()
    : [];
  const mathlib = Array.isArray(packages)
    ? packages.find((row) => row?.name === 'mathlib')
    : null;
  if (!isRecord(payload.lakeManifest)
      || !Array.isArray(packages)
      || canonicalJson(packageNames) !== canonicalJson(EXPECTED_LAKE_PACKAGE_NAMES)
      || mathlib?.type !== 'git'
      || mathlib?.rev !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit) {
    errors.push('proof runtime exact Lake manifest is invalid');
  }
  if (!Array.isArray(payload.leanRootManifest)
      || payload.leanRootManifest.length < 1
      || payload.leanRootManifest.some((row) => !validateFileManifestRow(row, {
        label: 'Lean root manifest',
        allowSymlink: true,
      }))) {
    errors.push('proof runtime exact Lean root manifest is invalid');
  }
  if (!Array.isArray(payload.compiledDependenciesManifest)
      || payload.compiledDependenciesManifest.length < 1
      || payload.compiledDependenciesManifest.some((row) => !validateFileManifestRow(row, {
        label: 'compiled dependency manifest',
        requireRoot: true,
      }))) {
    errors.push('proof runtime exact compiled-dependency manifest is invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function buildProofRuntimeEvidence(attestationBytes, requestBytes) {
  const bytes = Buffer.isBuffer(attestationBytes)
    ? Buffer.from(attestationBytes)
    : Buffer.from(attestationBytes || '');
  if (bytes.length < 2 || bytes.length > 64 * 1024 * 1024) {
    throw new Error('proof runtime attestation bytes are absent or oversized');
  }
  let text;
  let attestation;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    attestation = JSON.parse(text);
  } catch (error) {
    throw new Error(`proof runtime attestation bytes are not strict JSON: ${error.message}`);
  }
  if (text !== canonicalJson(attestation)) {
    throw new Error('proof runtime attestation bytes are not the exact canonical signed record');
  }
  const parsedRequest = parseProofRuntimeRequestBytes(requestBytes);
  const authorityPayload = attestation?.payload;
  if (!exactKeys(authorityPayload, [
    'schemaVersion',
    'requestSha256',
    'runtimePayload',
  ])
      || authorityPayload.schemaVersion !== PROOF_RUNTIME_AUTHORITY_PAYLOAD_SCHEMA
      || authorityPayload.requestSha256 !== parsedRequest.requestSha256
      || canonicalJson(authorityPayload.runtimePayload)
        !== canonicalJson(parsedRequest.payload)) {
    throw new Error('proof runtime attestation does not bind the exact emitted request');
  }
  return {
    schemaVersion: PROOF_RUNTIME_EVIDENCE_SCHEMA,
    fixtureOnly: authorityPayload.runtimePayload.fixtureOnly === true,
    authorityId: attestation?.authorityId,
    verificationKeySha256: attestation?.signature?.keyId,
    attestationSha256: sha256Bytes(bytes),
    runtimeIdentitySha256: sha256Text(canonicalJson(authorityPayload.runtimePayload)),
    requestBytesBase64: parsedRequest.bytes.toString('base64'),
    requestSha256: parsedRequest.requestSha256,
    attestationBytesBase64: bytes.toString('base64'),
    attestation,
  };
}

export function validateProofRuntimeEvidence(evidence, {
  trustPolicy = null,
  expectedDeployment = null,
  expectedPayload = null,
  allowFixture = false,
  requireAuthentication = true,
} = {}) {
  const errors = [];
  if (!exactKeys(evidence, [
    'schemaVersion',
    'fixtureOnly',
    'authorityId',
    'verificationKeySha256',
    'attestationSha256',
    'runtimeIdentitySha256',
    'requestBytesBase64',
    'requestSha256',
    'attestationBytesBase64',
    'attestation',
  ])) {
    return { ok: false, errors: ['proof runtime evidence fields are incomplete or unknown'] };
  }
  if (evidence.schemaVersion !== PROOF_RUNTIME_EVIDENCE_SCHEMA
      || typeof evidence.fixtureOnly !== 'boolean'
      || evidence.fixtureOnly
        !== (evidence.attestation?.payload?.runtimePayload?.fixtureOnly === true)
      || (evidence.fixtureOnly && allowFixture !== true)) {
    errors.push('proof runtime evidence schema or fixture boundary is invalid');
  }
  let bytes = Buffer.alloc(0);
  try {
    bytes = Buffer.from(evidence.attestationBytesBase64, 'base64');
    if (bytes.length < 2
        || bytes.toString('base64') !== evidence.attestationBytesBase64
        || new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          !== canonicalJson(evidence.attestation)) {
      throw new Error('non-canonical attestation bytes');
    }
  } catch {
    errors.push('proof runtime exact attestation bytes are invalid');
  }
  let parsedRequest = null;
  try {
    const requestBytes = Buffer.from(evidence.requestBytesBase64, 'base64');
    if (requestBytes.toString('base64') !== evidence.requestBytesBase64) {
      throw new Error('non-canonical request base64');
    }
    parsedRequest = parseProofRuntimeRequestBytes(requestBytes);
  } catch {
    errors.push('proof runtime exact request bytes are invalid');
  }
  const authorityPayload = evidence.attestation?.payload;
  if (!exactKeys(authorityPayload, [
    'schemaVersion',
    'requestSha256',
    'runtimePayload',
  ])
      || authorityPayload?.schemaVersion !== PROOF_RUNTIME_AUTHORITY_PAYLOAD_SCHEMA
      || !DIGEST.test(String(evidence.requestSha256 || ''))
      || evidence.requestSha256 !== parsedRequest?.requestSha256
      || authorityPayload?.requestSha256 !== evidence.requestSha256
      || canonicalJson(authorityPayload?.runtimePayload)
        !== canonicalJson(parsedRequest?.payload)) {
    errors.push('proof runtime authority payload does not authenticate the exact request');
  }
  if (!/^[0-9a-f]{64}$/.test(String(evidence.attestationSha256 || ''))
      || evidence.attestationSha256 !== sha256Bytes(bytes)
      || !/^[0-9a-f]{64}$/.test(String(evidence.runtimeIdentitySha256 || ''))
      || evidence.runtimeIdentitySha256
        !== sha256Text(canonicalJson(authorityPayload?.runtimePayload))
      || evidence.authorityId !== evidence.attestation?.authorityId
      || evidence.verificationKeySha256 !== evidence.attestation?.signature?.keyId) {
    errors.push('proof runtime attestation digest, authority, key, or identity binding mismatch');
  }
  const payloadValidation = validateRuntimePayloadStructure(authorityPayload?.runtimePayload, {
    expectedDeployment,
    trustPolicy,
    allowFixture,
  });
  errors.push(...payloadValidation.errors);
  if (expectedPayload !== null
      && canonicalJson(authorityPayload?.runtimePayload) !== canonicalJson(expectedPayload)) {
    errors.push('proof runtime attestation does not match the exact local runtime manifests');
  }
  if (requireAuthentication) {
    const trustValidation = validatePhdTrustPolicy(trustPolicy, {
      requireProduction: allowFixture !== true,
    });
    if (!trustValidation.ok) {
      errors.push(...trustValidation.errors.map((error) => `proof runtime trust policy: ${error}`));
    } else if (!verifyAuthorityAttestation(evidence.attestation, {
      trustPolicy,
      capability: 'proof_runtime',
    })) {
      errors.push('proof runtime authority attestation signature mismatch');
    }
  }
  return { ok: errors.length === 0, errors };
}

function verifyAuthenticatedRuntime({
  proofKernelRoot,
  leanRoot,
  expectedDeployment = null,
} = {}) {
  const trustPolicyPath = path.join(path.dirname(proofKernelRoot), 'policies/phd-production-trust.v1.json');
  const attestationPath = path.join(proofKernelRoot, 'proof-runtime-attestation.json');
  const requestPath = path.join(proofKernelRoot, 'proof-runtime-attestation-request.json');
  if (!fs.existsSync(trustPolicyPath) || !fs.existsSync(attestationPath)
      || !fs.existsSync(requestPath)) {
    throw new Error('authenticated proof runtime manifest is absent');
  }
  assertRegularFile(trustPolicyPath, 'proof runtime trust policy', 4 * 1024 * 1024);
  assertRegularFile(attestationPath, 'proof runtime attestation', 64 * 1024 * 1024);
  assertRegularFile(requestPath, 'proof runtime attestation request', 64 * 1024 * 1024);
  const trustPolicy = JSON.parse(fs.readFileSync(trustPolicyPath, 'utf8'));
  const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
  if (!trustValidation.ok) {
    throw new Error(`proof runtime trust policy is not production-ready: ${trustValidation.errors.join('; ')}`);
  }
  const attestationBytes = fs.readFileSync(attestationPath);
  const requestBytes = fs.readFileSync(requestPath);
  const runtimeEvidence = buildProofRuntimeEvidence(attestationBytes, requestBytes);
  const selectedDeployment = expectedDeployment
    || runtimeEvidence.attestation?.payload?.runtimePayload?.deployment;
  const expectedPayload = buildProofRuntimeAttestationPayload({
    proofKernelRoot,
    leanRoot,
    deployment: selectedDeployment,
    trustPolicy,
    fixtureOnly: false,
  });
  const validation = validateProofRuntimeEvidence(runtimeEvidence, {
    trustPolicy,
    expectedDeployment: selectedDeployment,
    expectedPayload,
  });
  if (!validation.ok) {
    throw new Error(`proof runtime authentication failed: ${validation.errors.join('; ')}`);
  }
  return {
    runtimeEvidence,
    trustPolicy,
  };
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
  expectedDeployment = null,
} = {}) {
  const kernelRoot = path.resolve(proofKernelRoot);
  const selectedLeanRoot = path.resolve(
    leanRoot || (proofKernelRoot === DEFAULT_PROOF_KERNEL_ROOT
      ? DEFAULT_LEAN_ROOT
      : path.join(kernelRoot, '.toolchain/lean-4.32.1-linux')),
  );
  const toolchainPath = path.join(kernelRoot, 'lean-toolchain');
  const lakefilePath = path.join(kernelRoot, 'lakefile.toml');
  const preludePath = path.join(kernelRoot, 'ProofKernel/Prelude.lean');
  const representativePath = path.join(kernelRoot, 'ProofKernel/Representative.lean');
  const rootModulePath = path.join(kernelRoot, 'ProofKernel.lean');

  try {
    assertDirectory(kernelRoot, 'proof-kernel root');
    checkExactFile(toolchainPath, EXPECTED_TOOLCHAIN_BYTES, 'lean-toolchain');
    checkExactFile(lakefilePath, EXPECTED_LAKEFILE_BYTES, 'lakefile.toml');
    checkExactFile(preludePath, EXPECTED_PRELUDE_BYTES, 'proof prelude');
    checkExactFile(representativePath, EXPECTED_REPRESENTATIVE_BYTES, 'representative proof');
    checkExactFile(rootModulePath, EXPECTED_ROOT_MODULE_BYTES, 'proof library root module');
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
    const authenticatedRuntimeResult = verifyAuthenticatedRuntime({
      proofKernelRoot: kernelRoot,
      leanRoot: selectedLeanRoot,
      expectedDeployment,
    });
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
      authenticatedRuntime: authenticatedRuntimeResult.runtimeEvidence,
      trustPolicy: authenticatedRuntimeResult.trustPolicy,
      errors: [],
      truthBoundary: PROOF_TRUTH_BOUNDARY,
    };
  } catch (error) {
    return invalidResult(kernelRoot, selectedLeanRoot, [error.message]);
  }
}
