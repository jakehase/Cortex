import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const AGENT_WORK_DEPLOYMENT_MANIFEST_SCHEMA = 'claw.agent_work_deployment_manifest.v0';
export const AGENT_WORK_DEPLOYMENT_VERIFICATION_SCHEMA = 'claw.agent_work_deployment_verification.v0';

const DEFAULT_EXCLUDE_RE = /(^|\/)(?:\.git|node_modules|artifacts|coverage|dist|build|\.cache)(?:\/|$)/;

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function stableList(value) {
  const input = Array.isArray(value) ? value : [value];
  return [...new Set(input.map(clean).filter(Boolean))];
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runGit(root, args, fallback = null) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function gitInfo(root) {
  const gitRoot = runGit(root, ['rev-parse', '--show-toplevel'], null);
  if (!gitRoot) return { present: false, root: null };
  const statusShort = runGit(gitRoot, ['status', '--short'], '') || '';
  return {
    present: true,
    root: gitRoot,
    commit: runGit(gitRoot, ['rev-parse', 'HEAD'], null),
    branch: runGit(gitRoot, ['branch', '--show-current'], null),
    remoteOriginUrl: runGit(gitRoot, ['remote', 'get-url', 'origin'], null),
    dirty: Boolean(statusShort.trim()),
    statusShort: statusShort.split(/\r?\n/).filter(Boolean),
    lastCommit: runGit(gitRoot, ['log', '-1', '--format=%H %s'], null)
  };
}

function fileMode(stat) {
  return `0${(stat.mode & 0o777).toString(8)}`;
}

function shouldExclude(rel, excludeRe = DEFAULT_EXCLUDE_RE) {
  return excludeRe.test(rel.split(path.sep).join('/'));
}

function walkFiles(root, target, excludeRe = DEFAULT_EXCLUDE_RE) {
  const out = [];
  const stat = fs.statSync(target);
  const rel = path.relative(root, target).split(path.sep).join('/');
  if (rel && shouldExclude(rel, excludeRe)) return out;
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return out;
  for (const name of fs.readdirSync(target).sort()) {
    out.push(...walkFiles(root, path.join(target, name), excludeRe));
  }
  return out;
}

export function collectDeploymentFiles({ root = process.cwd(), includePaths = [], excludeRe = DEFAULT_EXCLUDE_RE } = {}) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  for (const entry of stableList(includePaths)) {
    const target = path.resolve(resolvedRoot, entry);
    if (!fs.existsSync(target)) throw new Error(`deployment include path not found: ${entry}`);
    files.push(...walkFiles(resolvedRoot, target, excludeRe));
  }
  const unique = [...new Set(files.map((file) => path.resolve(file)))].sort();
  return unique.map((file) => {
    const stat = fs.statSync(file);
    const rel = path.relative(resolvedRoot, file).split(path.sep).join('/');
    const content = fs.readFileSync(file);
    return {
      path: rel,
      sizeBytes: stat.size,
      mode: fileMode(stat),
      executable: Boolean(stat.mode & 0o111),
      sha256: sha256Buffer(content)
    };
  });
}

export function createDeploymentManifest({
  root = process.cwd(),
  includePaths = [],
  remoteRoot = null,
  bundleId = null,
  generatedAt = nowIso(),
  metadata = {}
} = {}) {
  const resolvedRoot = path.resolve(root);
  const files = collectDeploymentFiles({ root: resolvedRoot, includePaths });
  const aggregateSha256 = sha256Buffer(JSON.stringify(files.map((entry) => [entry.path, entry.sizeBytes, entry.mode, entry.sha256])));
  return {
    schemaVersion: AGENT_WORK_DEPLOYMENT_MANIFEST_SCHEMA,
    generatedAt,
    bundleId: clean(bundleId) || `agent-work-deploy-${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    rootPath: resolvedRoot,
    remoteRoot: clean(remoteRoot) || null,
    git: gitInfo(resolvedRoot),
    fileCount: files.length,
    aggregateSha256,
    files,
    metadata: { ...metadata }
  };
}

export function writeDeploymentManifest({ outputPath, ...options } = {}) {
  if (!outputPath) throw new Error('outputPath is required');
  const manifest = createDeploymentManifest(options);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyDeploymentManifest({ root = process.cwd(), manifest } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is required');
  const resolvedRoot = path.resolve(root);
  const mismatches = [];
  for (const expected of manifest.files || []) {
    const file = path.resolve(resolvedRoot, expected.path);
    if (!fs.existsSync(file)) {
      mismatches.push({ path: expected.path, reason: 'missing_file', expectedSha256: expected.sha256, actualSha256: null });
      continue;
    }
    const stat = fs.statSync(file);
    const actualSha256 = sha256Buffer(fs.readFileSync(file));
    const actualMode = fileMode(stat);
    if (actualSha256 !== expected.sha256 || stat.size !== expected.sizeBytes || actualMode !== expected.mode) {
      mismatches.push({
        path: expected.path,
        reason: 'file_mismatch',
        expectedSha256: expected.sha256,
        actualSha256,
        expectedSizeBytes: expected.sizeBytes,
        actualSizeBytes: stat.size,
        expectedMode: expected.mode,
        actualMode
      });
    }
  }
  const observedFiles = (manifest.files || []).map((entry) => ({ path: entry.path, sizeBytes: entry.sizeBytes, mode: entry.mode, sha256: entry.sha256 }));
  const aggregateSha256 = sha256Buffer(JSON.stringify(observedFiles.map((entry) => [entry.path, entry.sizeBytes, entry.mode, entry.sha256])));
  if (aggregateSha256 !== manifest.aggregateSha256) {
    mismatches.push({ path: '<manifest>', reason: 'aggregate_sha256_mismatch', expectedSha256: manifest.aggregateSha256, actualSha256: aggregateSha256 });
  }
  return {
    schemaVersion: AGENT_WORK_DEPLOYMENT_VERIFICATION_SCHEMA,
    generatedAt: nowIso(),
    manifestSchemaVersion: manifest.schemaVersion || null,
    bundleId: manifest.bundleId || null,
    rootPath: resolvedRoot,
    ok: mismatches.length === 0,
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    aggregateSha256: manifest.aggregateSha256 || null,
    mismatches
  };
}

export function readDeploymentManifest(manifestPath) {
  if (!manifestPath) throw new Error('manifestPath is required');
  return JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
}
