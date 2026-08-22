#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SYNTHETIC_LABOR_OS_REMOTE_SYNC_PATHS,
  createRemoteDispatchManifest,
  evaluateRemoteDispatchResult,
  verifyArtifactBundleManifest,
  writeSyntheticLaborOsJob
} from '../../packages/synthetic-labor-os/index.mjs';

export {
  createRemoteDispatchManifest,
  evaluateRemoteDispatchResult
} from '../../packages/synthetic-labor-os/index.mjs';

function parseArgs(argv) {
  const args = {
    jobPath: null,
    artifactRoot: null,
    localRepoPath: process.cwd(),
    remoteHost: process.env.SYNTHETIC_LABOR_OS_REMOTE_HOST || 'jake@37.27.129.239',
    remoteRepoPath: process.env.SYNTHETIC_LABOR_OS_REMOTE_REPO || '/home/jake/clawd-remote/large-project-capability-stack',
    remoteArtifactRoot: null,
    command: 'node --version',
    codeSyncPaths: [],
    noCodeSync: false,
    noArtifactReturn: false,
    write: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--job') { args.jobPath = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--local-repo') { args.localRepoPath = next; index += 1; continue; }
    if (token === '--remote' || token === '--remote-host') { args.remoteHost = next; index += 1; continue; }
    if (token === '--remote-repo') { args.remoteRepoPath = next; index += 1; continue; }
    if (token === '--remote-artifact-root') { args.remoteArtifactRoot = next; index += 1; continue; }
    if (token === '--command') { args.command = next; index += 1; continue; }
    if (token === '--sync-path') { args.codeSyncPaths.push(next); index += 1; continue; }
    if (token === '--no-code-sync') { args.noCodeSync = true; continue; }
    if (token === '--no-artifact-return') { args.noArtifactReturn = true; continue; }
    if (token === '--no-write') { args.write = false; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/remote-dispatcher.mjs --job JOB_JSON --artifact-root ROOT [--remote jake@37.27.129.239] [--remote-repo PATH] [--remote-artifact-root PATH] [--command CMD]

Syncs the Synthetic Labor OS control-plane code to a remote execution plane, runs the remote local-runner on a queued job, pulls artifacts back, verifies the returned artifact bundle manifest, and writes a remote dispatch result. Bundle verification means returned files match the manifest; it does not merge, publish, send externally, deploy, release, or launch heavy swarms.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.jobPath) throw new Error('--job JOB_JSON is required');
  if (!args.artifactRoot) throw new Error('--artifact-root ROOT is required');
  return args;
}

function safeFileStamp(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function shellQuote(value = '') {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function readReturnedArtifactIntegrity(returnDir, artifactReturn) {
  if (artifactReturn.returned !== true) return null;
  const manifestPath = path.join(returnDir, 'artifact_bundle_manifest.json');
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    return {
      schemaVersion: 'claw.synthetic_labor_os.v2.artifact_bundle_verification',
      generatedAt: new Date().toISOString(),
      artifactRoot: returnDir,
      ok: false,
      missingManifest: true,
      summary: {
        ok: false,
        fileCount: 0,
        verifiedFileCount: 0,
        missingCount: 0,
        mismatchCount: 0,
        invalidPathCount: 0,
        expectedTotalBytes: 0,
        actualTotalBytes: 0,
        byteDelta: 0
      },
      truthBoundary: 'Returned artifacts cannot be integrity-verified without artifact_bundle_manifest.json.'
    };
  }
  return verifyArtifactBundleManifest({ artifactRoot: returnDir, manifest });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function computeLocalHashes(repoPath, paths) {
  const hashes = {};
  const missing = [];
  for (const relPath of paths) {
    const absolutePath = path.join(repoPath, relPath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      missing.push(relPath);
      continue;
    }
    hashes[relPath] = sha256File(absolutePath);
  }
  return { hashes, missing };
}

function parseSha256Output(output = '') {
  const hashes = {};
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
    if (!match) continue;
    hashes[match[2].trim()] = match[1].toLowerCase();
  }
  return hashes;
}

function runLogged(command, args, { cwd = process.cwd(), logPath = null, input = null } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', input, maxBuffer: 20 * 1024 * 1024 });
  const finished = Date.now();
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, [
      `$ ${[command, ...args].join(' ')}`,
      `cwd: ${cwd}`,
      `exitCode: ${result.status ?? 1}`,
      `signal: ${result.signal || ''}`,
      `durationMs: ${finished - started}`,
      '',
      '--- stdout ---',
      result.stdout || '',
      '--- stderr ---',
      result.stderr || '',
      ''
    ].join('\n'));
  }
  return { ...result, durationMs: finished - started };
}

function compareHashes(localHashes, remoteHashes, paths) {
  const mismatches = [];
  for (const relPath of paths) {
    if (!localHashes[relPath] || !remoteHashes[relPath] || localHashes[relPath] !== remoteHashes[relPath]) {
      mismatches.push({ path: relPath, local: localHashes[relPath] || null, remote: remoteHashes[relPath] || null });
    }
  }
  return mismatches;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const localRepoPath = path.resolve(args.localRepoPath);
  const localJobPath = path.resolve(args.jobPath);
  const artifactRoot = path.resolve(args.artifactRoot);
  const job = readJson(localJobPath, null);
  if (!job?.id) throw new Error(`job JSON with id required at ${localJobPath}`);

  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v2/remote-dispatch/${job.id}`;
  const remoteJobPath = `${remoteArtifactRoot.replace(/\/+$/, '')}/jobs/${job.id}.json`;
  const codeSyncPaths = args.codeSyncPaths.length ? args.codeSyncPaths : Array.from(DEFAULT_SYNTHETIC_LABOR_OS_REMOTE_SYNC_PATHS);
  const dispatchDir = path.join(artifactRoot, 'remote_dispatch', job.id, safeFileStamp(new Date().toISOString()));
  fs.mkdirSync(dispatchDir, { recursive: true });

  const manifest = createRemoteDispatchManifest({
    job,
    localRepoPath,
    localArtifactRoot: artifactRoot,
    remoteHost: args.remoteHost,
    remoteRepoPath: args.remoteRepoPath,
    remoteArtifactRoot,
    remoteJobPath,
    command: args.command,
    codeSyncPaths
  });
  const manifestPath = writeJson(path.join(dispatchDir, 'remote_dispatch_manifest.json'), manifest);
  if (!manifest.okToLaunch) throw new Error(`remote dispatch manifest not launch-ready: ${manifest.failures.join(', ')}`);

  const localHashProof = computeLocalHashes(localRepoPath, codeSyncPaths);
  if (localHashProof.missing.length) throw new Error(`cannot sync missing local files: ${localHashProof.missing.join(', ')}`);

  const mkdirCommand = `mkdir -p ${shellQuote(path.posix.dirname(remoteJobPath))} ${shellQuote(remoteArtifactRoot)} ${shellQuote(args.remoteRepoPath)}`;
  const mkdirRun = runLogged('ssh', [args.remoteHost, mkdirCommand], { logPath: path.join(dispatchDir, 'remote_mkdir.log') });
  if (mkdirRun.status !== 0) throw new Error(`remote mkdir failed; see ${path.join(dispatchDir, 'remote_mkdir.log')}`);

  let codeSyncRun = { status: 0, stdout: '', stderr: '', durationMs: 0 };
  if (!args.noCodeSync) {
    const codeSyncCommand = [
      `tar -czf - ${codeSyncPaths.map(shellQuote).join(' ')}`,
      `ssh ${shellQuote(args.remoteHost)} "cd ${shellQuote(args.remoteRepoPath)} && tar -xzf -"`
    ].join(' | ');
    codeSyncRun = runLogged('bash', ['-lc', codeSyncCommand], {
      cwd: localRepoPath,
      logPath: path.join(dispatchDir, 'code_sync.log')
    });
    if (codeSyncRun.status !== 0) throw new Error(`code sync failed; see ${path.join(dispatchDir, 'code_sync.log')}`);
  }

  const jobSyncRun = runLogged('ssh', [args.remoteHost, `cat > ${shellQuote(remoteJobPath)}`], {
    cwd: localRepoPath,
    input: fs.readFileSync(localJobPath),
    logPath: path.join(dispatchDir, 'job_sync.log')
  });
  if (jobSyncRun.status !== 0) throw new Error(`job sync failed; see ${path.join(dispatchDir, 'job_sync.log')}`);

  const hashCommand = `cd ${shellQuote(args.remoteRepoPath)} && sha256sum ${codeSyncPaths.map(shellQuote).join(' ')}`;
  const remoteHashRun = runLogged('ssh', [args.remoteHost, hashCommand], { logPath: path.join(dispatchDir, 'remote_hash.log') });
  const remoteHashes = remoteHashRun.status === 0 ? parseSha256Output(remoteHashRun.stdout) : {};
  const hashMismatches = compareHashes(localHashProof.hashes, remoteHashes, codeSyncPaths);
  const syncProof = {
    schemaVersion: 'claw.synthetic_labor_os.v2.sync_proof',
    generatedAt: new Date().toISOString(),
    codeSyncSkipped: args.noCodeSync,
    localRepoPath,
    remoteHost: args.remoteHost,
    remoteRepoPath: args.remoteRepoPath,
    codeSyncPaths,
    localHashes: localHashProof.hashes,
    remoteHashes,
    remoteHashExitCode: remoteHashRun.status,
    matched: remoteHashRun.status === 0 && hashMismatches.length === 0,
    mismatches: hashMismatches,
    logs: {
      codeSyncLog: path.join(dispatchDir, 'code_sync.log'),
      jobSyncLog: path.join(dispatchDir, 'job_sync.log'),
      remoteHashLog: path.join(dispatchDir, 'remote_hash.log')
    },
    truthBoundary: 'Sync proof compares local and remote code hashes before accepting the remote run.'
  };
  writeJson(path.join(dispatchDir, 'sync_proof.json'), syncProof);
  if (!syncProof.matched) throw new Error(`remote sync proof failed; see ${path.join(dispatchDir, 'sync_proof.json')}`);

  const remoteRunnerCommand = [
    `cd ${shellQuote(args.remoteRepoPath)}`,
    `node apps/synthetic-labor-os/local-runner.mjs --job ${shellQuote(remoteJobPath)} --artifact-root ${shellQuote(remoteArtifactRoot)} --cwd ${shellQuote(args.remoteRepoPath)} --command ${shellQuote(args.command)} --actor synthetic-labor-os-remote-dispatcher`
  ].join(' && ');
  const remoteRun = runLogged('ssh', [args.remoteHost, remoteRunnerCommand], {
    logPath: path.join(dispatchDir, 'remote_runner.log')
  });
  fs.writeFileSync(path.join(dispatchDir, 'remote_runner.stdout.json'), remoteRun.stdout || '');
  fs.writeFileSync(path.join(dispatchDir, 'remote_runner.stderr.log'), remoteRun.stderr || '');
  const runnerPayload = remoteRun.stdout ? JSON.parse(remoteRun.stdout) : null;

  const returnDir = path.join(dispatchDir, 'returned_artifacts');
  let returnRun = { status: 0, stdout: '', stderr: '', durationMs: 0 };
  if (!args.noArtifactReturn) {
    fs.mkdirSync(returnDir, { recursive: true });
    const artifactReturnCommand = `ssh ${shellQuote(args.remoteHost)} "cd ${shellQuote(remoteArtifactRoot)} && tar -czf - ." | tar -xzf - -C ${shellQuote(returnDir)}`;
    returnRun = runLogged('bash', ['-lc', artifactReturnCommand], {
      logPath: path.join(dispatchDir, 'artifact_return.log')
    });
  }
  const artifactReturn = {
    schemaVersion: 'claw.synthetic_labor_os.v2.artifact_return',
    generatedAt: new Date().toISOString(),
    returned: !args.noArtifactReturn && returnRun.status === 0,
    returnExitCode: returnRun.status,
    remoteArtifactRoot,
    localReturnDir: returnDir,
    logPath: path.join(dispatchDir, 'artifact_return.log')
  };
  const artifactIntegrity = readReturnedArtifactIntegrity(returnDir, artifactReturn);
  const artifactIntegrityPath = artifactIntegrity ? writeJson(path.join(dispatchDir, 'artifact_integrity.json'), artifactIntegrity) : null;

  const result = evaluateRemoteDispatchResult({
    manifest,
    syncProof,
    remoteRun: {
      exitCode: remoteRun.status,
      stdoutPath: path.join(dispatchDir, 'remote_runner.stdout.json'),
      stderrPath: path.join(dispatchDir, 'remote_runner.stderr.log'),
      runnerPayload
    },
    artifactReturn,
    artifactIntegrity,
    runnerPayload
  });
  const resultPath = writeJson(path.join(dispatchDir, 'remote_dispatch_result.json'), result);

  const returnedJobPath = path.join(returnDir, 'jobs', `${job.id}.json`);
  const returnedJob = readJson(returnedJobPath, null);
  let finalJob = returnedJob || job;
  finalJob = {
    ...finalJob,
    artifacts: {
      ...(finalJob.artifacts || {}),
      remoteDispatchManifest: manifest,
      remoteDispatchSyncProof: syncProof,
      remoteDispatchResult: result,
      remoteArtifactIntegrity: artifactIntegrity,
      remoteCompletionSummary: result.completionSummary
    },
    metrics: {
      ...(finalJob.metrics || {}),
      remoteDispatchOk: result.ok,
      remoteDispatchExitCode: remoteRun.status
    }
  };

  const written = {
    manifestPath,
    syncProofPath: path.join(dispatchDir, 'sync_proof.json'),
    remoteRunnerLogPath: path.join(dispatchDir, 'remote_runner.log'),
    resultPath,
    artifactIntegrityPath,
    artifactReturnPath: path.join(dispatchDir, 'artifact_return.log'),
    returnedJobPath: fs.existsSync(returnedJobPath) ? returnedJobPath : null
  };

  if (args.write) {
    fs.writeFileSync(localJobPath, `${JSON.stringify(finalJob, null, 2)}\n`);
    written.localJobPath = localJobPath;
    written.artifactJobPath = writeSyntheticLaborOsJob({ job: finalJob, jobsDir: path.join(artifactRoot, 'jobs'), fileName: `${finalJob.id}.json` }).jobPath;
  }

  console.log(JSON.stringify({
    ok: result.ok,
    jobId: job.id,
    dispatchDir,
    remoteHost: args.remoteHost,
    remoteArtifactRoot,
    written,
    result,
    truthBoundary: 'Remote dispatch result is scoped to this bounded job. It does not merge, publish, send externally, or prove broad scale.'
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
