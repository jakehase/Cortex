import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'execution-boundary-policy.json'), 'utf8'));
const remote = POLICY.remoteExecution || {};
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'full_audit_campaign');
const PROOF_PATH = path.join(ARTIFACT_DIR, 'baseline_proof.json');
const LOG_PATH = path.join(ARTIFACT_DIR, 'baseline_refresh.log');

function sshBaseArgs() {
  const args = [];
  if (remote.keyPath) args.push('-i', remote.keyPath);
  args.push('-o', `BatchMode=${remote.batchMode === false ? 'no' : 'yes'}`);
  args.push('-o', `ConnectTimeout=${Number(remote.connectTimeoutSec || 10)}`);
  args.push('-o', `StrictHostKeyChecking=${remote.strictHostKeyChecking === false ? 'no' : 'yes'}`);
  if (remote.userKnownHostsFile) args.push('-o', `UserKnownHostsFile=${remote.userKnownHostsFile}`);
  if (remote.proxyJump) args.push('-J', remote.proxyJump);
  if (remote.port) args.push('-p', String(remote.port));
  args.push(`${remote.user}@${remote.host}`);
  return args;
}
function run(remoteCommand, timeout = 3_600_000) {
  return spawnSync('ssh', [...sshBaseArgs(), remoteCommand], { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 * 400 });
}
function writeJson(filePath, payload) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`); }

const repoPath = path.join(remote.workdir, 'mailchimp-clone');
const command = [
  `cd ${repoPath}`,
  'git reset --hard HEAD',
  'git clean -fd',
  'node --test --test-concurrency=1 tests/browser-realism.test.mjs',
  'npm test -- --runInBand'
].join(' && ');
const result = run(command);
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n[spawn-error] ${String(result.error.message || result.error)}` : ''}`);
writeJson(PROOF_PATH, {
  generatedAt: new Date().toISOString(),
  ok: result.status === 0 && !result.error,
  remoteHost: remote.host,
  repoPath,
  command,
  exitCode: result.status,
  signal: result.signal,
  spawnError: result.error ? String(result.error.message || result.error) : null,
  logPath: path.relative(ROOT, LOG_PATH)
});
process.exit(result.status || (result.error ? 1 : 0));
