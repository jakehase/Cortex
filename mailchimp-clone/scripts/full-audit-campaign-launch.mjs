import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { archiveArtifactRoots } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function makeLaunchStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function makeRunId(prefix = 'one-pass-launch') {
  return `${prefix}-${makeLaunchStamp()}`;
}

function makeCampaignRunId() {
  return `campaign-${makeLaunchStamp()}-${crypto.randomBytes(3).toString('hex')}`;
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const launchRunId = process.env.MAILCHIMP_FULL_AUDIT_RUN_ID || makeRunId();
const campaignRunId = process.env.MAILCHIMP_CAMPAIGN_RUN_ID || makeCampaignRunId();
const oneShot = process.env.MAILCHIMP_ONE_SHOT === '1';
const benchmarkContractSourcePath = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH
  ? path.resolve(process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH)
  : null;
const benchmarkContractTargetPath = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'one_pass_run_contract.latest.json');

const archived = archiveArtifactRoots({
  repoRoot: ROOT,
  archiveBaseDir: path.join('artifacts', 'reruns'),
  artifactRoots: [
    path.join('artifacts', 'full_audit_campaign'),
    path.join('artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline')
  ],
  stamp: makeLaunchStamp()
});

if (benchmarkContractSourcePath) {
  if (!fs.existsSync(benchmarkContractSourcePath)) {
    console.error(`Benchmark contract not found: ${benchmarkContractSourcePath}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(benchmarkContractTargetPath), { recursive: true });
  fs.copyFileSync(benchmarkContractSourcePath, benchmarkContractTargetPath);
}

const benchmarkContract = readJsonIfExists(benchmarkContractTargetPath, null);
const contractLaunchEnv = benchmarkContract?.launchEnvironment && typeof benchmarkContract.launchEnvironment === 'object'
  ? benchmarkContract.launchEnvironment
  : {};
const sharedEnv = {
  ...contractLaunchEnv,
  ...process.env,
  MAILCHIMP_FULL_AUDIT_RUN_ID: launchRunId,
  MAILCHIMP_CAMPAIGN_RUN_ID: campaignRunId
};

const run = (script) => spawnSync(process.execPath, [script], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit',
  env: sharedEnv
});

const persistent = oneShot ? null : run('scripts/full-audit-campaign-persistent-runner.mjs');
const worker = oneShot ? run('scripts/full-audit-campaign-worker-100-agent.mjs') : { status: null };
const supervisor = oneShot ? run('scripts/full-audit-campaign-supervisor.mjs') : { status: null };
const watcher = oneShot || persistent
  ? run('scripts/full-audit-campaign-watch.mjs')
  : { status: null };

console.log(JSON.stringify({
  archiveRoot: path.relative(ROOT, archived.archiveRoot),
  archivedCount: archived.archived.length,
  runId: launchRunId,
  campaignRunId,
  mode: oneShot ? 'one_shot' : 'persistent',
  benchmarkContractSourcePath: benchmarkContractSourcePath ? path.relative(ROOT, benchmarkContractSourcePath) : null,
  benchmarkContractTargetPath: fs.existsSync(benchmarkContractTargetPath) ? path.relative(ROOT, benchmarkContractTargetPath) : null,
  contractLaunchEnvironmentKeys: Object.keys(contractLaunchEnv).sort(),
  persistentExitCode: persistent?.status ?? null,
  workerExitCode: worker.status,
  supervisorExitCode: supervisor.status,
  watcherExitCode: watcher.status
}, null, 2));

process.exit(persistent?.status || worker.status || supervisor.status || watcher.status || 0);
