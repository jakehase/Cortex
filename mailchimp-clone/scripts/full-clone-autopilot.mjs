#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAutofix,
  artifactPaths,
  buildArtifactSnapshot,
  buildRelaunchPlan,
  classifyAutopilot,
  readAutopilotState,
  recordCycle,
  runRelaunch,
  writeJson
} from './lib/full-clone-autopilot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { maxCycles: 1, dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') out.dryRun = true;
    else if (token === '--once') out.maxCycles = 1;
    else if (token === '--max-cycles') out.maxCycles = Math.max(1, Number(argv[index + 1] || 1));
    else if (token === '--state') out.statePath = argv[index + 1];
  }
  return out;
}

const args = parseArgs(process.argv);
const paths = artifactPaths(ROOT);
const statePath = args.statePath ? path.resolve(ROOT, args.statePath) : paths.autopilotStatePath;
let state = readAutopilotState(statePath);
const cycleOutputs = [];
let finalStatus = 'unknown';
let exitCode = 0;

for (let cycleIndex = 1; cycleIndex <= args.maxCycles; cycleIndex += 1) {
  const snapshot = buildArtifactSnapshot(ROOT);
  const classification = classifyAutopilot(snapshot, state);
  const cycle = {
    cycleIndex,
    startedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    classification,
    fix: null,
    relaunch: null
  };

  if (classification.action === 'finish') {
    finalStatus = 'green';
    cycle.finishedAt = new Date().toISOString();
    state = recordCycle(state, cycle);
    state.status = 'green';
    writeJson(statePath, state);
    cycleOutputs.push(cycle);
    break;
  }

  if (classification.action === 'wait') {
    finalStatus = 'running';
    cycle.finishedAt = new Date().toISOString();
    state = recordCycle(state, cycle);
    state.status = 'running';
    writeJson(statePath, state);
    cycleOutputs.push(cycle);
    break;
  }

  if (classification.action === 'hard_block') {
    finalStatus = 'blocked';
    exitCode = 1;
    cycle.finishedAt = new Date().toISOString();
    state = recordCycle(state, cycle);
    state.status = 'blocked';
    writeJson(statePath, state);
    cycleOutputs.push(cycle);
    break;
  }

  if (classification.action === 'fix_then_relaunch') {
    const fixResult = applyAutofix(classification, state);
    cycle.fix = fixResult.fix;
    state = fixResult.state;
    if (!fixResult.ok) {
      finalStatus = 'blocked';
      exitCode = 1;
      cycle.finishedAt = new Date().toISOString();
      state = recordCycle(state, cycle);
      state.status = 'blocked';
      writeJson(statePath, state);
      cycleOutputs.push(cycle);
      break;
    }
  }

  if (classification.action === 'relaunch' || classification.action === 'fix_then_relaunch') {
    const relaunchPlan = buildRelaunchPlan({
      rootDir: ROOT,
      state,
      cycleIndex: (state.cycles?.length || 0) + 1
    });
    const relaunch = runRelaunch(relaunchPlan, { dryRun: args.dryRun });
    cycle.relaunch = {
      ok: relaunch.ok,
      dryRun: relaunch.dryRun,
      exitCode: relaunch.exitCode,
      signal: relaunch.signal || null,
      error: relaunch.error || null,
      campaignRunId: relaunchPlan.campaignRunId,
      env: relaunchPlan.env,
      stdoutTail: relaunch.stdout ? relaunch.stdout.slice(-4000) : '',
      stderrTail: relaunch.stderr ? relaunch.stderr.slice(-4000) : ''
    };
    cycle.finishedAt = new Date().toISOString();
    state = recordCycle(state, cycle);
    state.status = relaunch.ok ? 'relaunched' : 'relaunch_failed';
    writeJson(statePath, state);
    cycleOutputs.push(cycle);
    if (!relaunch.ok && !args.dryRun) {
      finalStatus = 'relaunch_failed';
      exitCode = relaunch.exitCode || 1;
      break;
    }
    finalStatus = args.dryRun ? 'dry_run_complete' : 'relaunched';
    if (!args.dryRun) break;
  }
}

const output = {
  ok: exitCode === 0,
  finalStatus,
  statePath: path.relative(ROOT, statePath),
  cycles: cycleOutputs
};
console.log(JSON.stringify(output, null, 2));
process.exit(exitCode);
