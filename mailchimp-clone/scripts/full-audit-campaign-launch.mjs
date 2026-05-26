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
const autopilotEnabled = process.env.MAILCHIMP_FULL_CLONE_AUTOPILOT === '1'
  && process.env.MAILCHIMP_AUTOPILOT_CHILD !== '1'
  && !oneShot;
const benchmarkContractSourcePath = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH
  ? path.resolve(process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH)
  : null;
const benchmarkContractTargetPath = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'one_pass_run_contract.latest.json');
const benchmarkContractRuntimeEnvPath = benchmarkContractSourcePath
  ? path.relative(ROOT, benchmarkContractTargetPath)
  : process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH;
const skipArtifactArchive = process.env.MAILCHIMP_SKIP_ARTIFACT_ARCHIVE === '1'
  || process.env.MAILCHIMP_ARCHIVE_PRIOR_ARTIFACTS === '0';

const archived = skipArtifactArchive
  ? {
      archiveRoot: path.join(ROOT, 'artifacts', 'reruns', `skipped-${makeLaunchStamp()}`),
      archived: [],
      logPath: null,
      skipped: true,
      reason: 'MAILCHIMP_SKIP_ARTIFACT_ARCHIVE=1 or MAILCHIMP_ARCHIVE_PRIOR_ARTIFACTS=0'
    }
  : archiveArtifactRoots({
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
} else {
  fs.rmSync(benchmarkContractTargetPath, { force: true });
}

const benchmarkContract = readJsonIfExists(benchmarkContractTargetPath, null);
const contractLaunchEnv = benchmarkContract?.launchEnvironment && typeof benchmarkContract.launchEnvironment === 'object'
  ? benchmarkContract.launchEnvironment
  : {};
const sharedEnv = {
  ...contractLaunchEnv,
  ...process.env,
  ...(benchmarkContractRuntimeEnvPath ? { MAILCHIMP_ONE_PASS_CONTRACT_PATH: benchmarkContractRuntimeEnvPath } : {}),
  MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR
    ?? contractLaunchEnv.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR
    ?? '1',
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
const autopilot = autopilotEnabled && persistent?.status
  ? run('scripts/full-clone-autopilot.mjs')
  : { status: null };

console.log(JSON.stringify({
  archiveRoot: path.relative(ROOT, archived.archiveRoot),
  archivedCount: archived.archived.length,
  archiveSkipped: archived.skipped === true,
  archiveSkipReason: archived.reason || null,
  runId: launchRunId,
  campaignRunId,
  mode: oneShot ? 'one_shot' : 'persistent',
  benchmarkContractSourcePath: benchmarkContractSourcePath ? path.relative(ROOT, benchmarkContractSourcePath) : null,
  benchmarkContractTargetPath: fs.existsSync(benchmarkContractTargetPath) ? path.relative(ROOT, benchmarkContractTargetPath) : null,
  contractLaunchEnvironmentKeys: Object.keys(contractLaunchEnv).sort(),
  persistentExitCode: persistent?.status ?? null,
  workerExitCode: worker.status,
  supervisorExitCode: supervisor.status,
  watcherExitCode: watcher.status,
  autopilotEnabled,
  autopilotExitCode: autopilot.status
}, null, 2));

process.exit(autopilot.status ?? (persistent?.status || worker.status || supervisor.status || watcher.status || 0));
