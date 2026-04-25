import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QUAL_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline');
const SOAK_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_soak');
const STATUS_PATH = path.join(SOAK_ROOT, 'soak_status.json');
const ROUNDS_DIR = path.join(SOAK_ROOT, 'rounds');
const RUN_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-run.mjs');
const ROUNDS = Number(process.env.MAILCHIMP_SOAK_ROUNDS || 12);
const STOP_ON_FAILURE = process.env.MAILCHIMP_SOAK_STOP_ON_FAILURE !== '0';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function cpIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

ensureDir(SOAK_ROOT);
ensureDir(ROUNDS_DIR);

const rounds = [];
let overallOk = true;

for (let round = 1; round <= ROUNDS; round += 1) {
  fs.rmSync(QUAL_ROOT, { recursive: true, force: true });
  const startedAt = new Date().toISOString();
  writeJson(STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: true,
    currentRound: round,
    totalRounds: ROUNDS,
    stopOnFailure: STOP_ON_FAILURE,
    rounds,
    note: 'Running repeated real-repo 100-tier Mailchimp qualification rounds on the execution plane.'
  });

  const result = spawnSync(process.execPath, [RUN_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 200,
    env: {
      ...process.env,
      ORCHESTRATOR_RESUME_CAMPAIGN: '0'
    }
  });

  const completionSummary = readJson(path.join(QUAL_ROOT, 'completion_summary.json'), null);
  const programState = readJson(path.join(QUAL_ROOT, 'program_state.json'), null);
  const campaignState = readJson(path.join(QUAL_ROOT, 'campaign_state.json'), null);
  const roundDir = path.join(ROUNDS_DIR, `round-${String(round).padStart(3, '0')}`);
  fs.rmSync(roundDir, { recursive: true, force: true });
  cpIfExists(QUAL_ROOT, roundDir);
  fs.writeFileSync(path.join(roundDir, 'stdout-stderr.log'), `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n[spawn-error] ${String(result.error.message || result.error)}` : ''}`);

  const roundRecord = {
    round,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.status,
    signal: result.signal,
    spawnError: result.error ? String(result.error.message || result.error) : null,
    ok: result.status === 0 && !result.error,
    supervisorStatus: completionSummary?.supervisorStatus || programState?.supervisorStatus || campaignState?.supervisor?.status || null,
    matrixStatus: completionSummary?.surfaceMatrixStatus || programState?.matrixStatus || campaignState?.supervisor?.matrixStatus || null,
    highestPassingTier: completionSummary?.provenCoordinationScaleTier || programState?.provenCoordinationScaleTier || null,
    blocker: completionSummary?.blocker || programState?.blocker || campaignState?.supervisor?.blocker || null,
    archivedRoundPath: path.relative(ROOT, roundDir)
  };
  rounds.push(roundRecord);
  writeJson(STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: false,
    currentRound: round,
    totalRounds: ROUNDS,
    stopOnFailure: STOP_ON_FAILURE,
    rounds,
    lastRound: roundRecord,
    overallOk: overallOk && roundRecord.ok,
    note: roundRecord.ok
      ? 'Latest soak round completed green.'
      : 'Latest soak round failed; inspect the archived round artifact root.'
  });

  if (!roundRecord.ok) {
    overallOk = false;
    if (STOP_ON_FAILURE) break;
  }
}

writeJson(STATUS_PATH, {
  generatedAt: new Date().toISOString(),
  running: false,
  completedRounds: rounds.length,
  totalRounds: ROUNDS,
  stopOnFailure: STOP_ON_FAILURE,
  rounds,
  overallOk,
  note: overallOk
    ? 'Soak run completed all requested rounds green.'
    : 'Soak run encountered at least one failed round.'
});

process.exit(overallOk ? 0 : 1);
