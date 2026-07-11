#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_WORK_COMMANDS,
  AGENT_WORK_EXIT_CODES,
  buildCompletionPacket,
  cancelRun,
  compileObjective,
  doctor,
  getRunStatus,
  replayRun,
  resumeRun,
  startRun,
  verifyRun
} from '../../packages/canonical-agent-work/index.mjs';

const args = process.argv.slice(2);

function value(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function has(flag) {
  return args.includes(flag);
}

function positional(after = 0) {
  return args.slice(after).filter((arg, index, all) => {
    if (arg.startsWith('--')) return false;
    const previous = all[index - 1];
    return !previous?.startsWith('--');
  });
}

function readInput(token) {
  if (!token) throw new Error('objective or handoff input is required');
  const candidate = path.resolve(token);
  if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  return token;
}

function configFromFlags() {
  const config = {};
  const configPath = value('--config');
  if (configPath) Object.assign(config, JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8')));
  for (const [flag, key] of [
    ['--target-path', 'targetPath'],
    ['--fidelity', 'fidelity'],
    ['--execution-boundary', 'executionBoundary']
  ]) {
    const flagValue = value(flag);
    if (flagValue) config[key] = flagValue;
  }
  return config;
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
}

function errorResult(operation, error, exitCode = AGENT_WORK_EXIT_CODES.invalidOrDenied) {
  return {
    schemaVersion: 'clawd.agent_work.cli_result.v1',
    generatedAt: new Date().toISOString(),
    operation,
    ok: false,
    state: 'invalid_input',
    exitCode,
    runId: null,
    blockerFamily: 'malformed_input',
    blockerCode: 'cli_input_error',
    nextAction: 'Fix the command arguments or input JSON and retry.',
    artifacts: {},
    data: { error: error?.message || String(error) },
    warnings: [],
    truthBoundary: 'Malformed CLI input cannot be promoted into an Agent Work contract.'
  };
}

function usageResult() {
  return {
    schemaVersion: 'clawd.agent_work.cli_result.v1',
    generatedAt: new Date().toISOString(),
    operation: 'usage',
    ok: false,
    state: 'invalid_input',
    exitCode: AGENT_WORK_EXIT_CODES.invalidOrDenied,
    runId: null,
    blockerFamily: 'malformed_input',
    blockerCode: 'usage_required',
    nextAction: 'Use: agent-work <plan|run|status|resume|cancel|verify|report|doctor|replay> ...',
    artifacts: {},
    data: { commands: AGENT_WORK_COMMANDS },
    warnings: [],
    truthBoundary: 'The stable Agent Work CLI is one command family.'
  };
}

async function main() {
  if (!args.length) return printResult(usageResult());
  const command = args[0];
  try {
    if (!AGENT_WORK_COMMANDS.includes(command)) {
      const legacyOut = value('--out');
      const legacyInput = args.find((arg) => !arg.startsWith('--'));
      if (legacyInput && legacyOut) {
        console.error('[compatibility-warning] positional canonical-agent-work.mjs syntax is compatibility-only; use `agent-work plan <handoff> --out <run-root>`.');
        return printResult(compileObjective({ input: readInput(legacyInput), outputDir: path.resolve(legacyOut), config: configFromFlags() }));
      }
      return printResult(usageResult());
    }

    if (command === 'plan') {
      const inputToken = positional(1)[0];
      const out = value('--out');
      if (!out) throw new Error('plan requires --out <run-root>');
      return printResult(compileObjective({ input: readInput(inputToken), outputDir: path.resolve(out), config: configFromFlags() }));
    }

    if (command === 'run') {
      const runRoot = positional(1)[0];
      return printResult(startRun({ runRoot, config: configFromFlags(), dryRun: has('--dry-run') }));
    }

    if (command === 'status') {
      const runRoot = positional(1)[0];
      return printResult(getRunStatus({ runRoot }));
    }

    if (command === 'resume') {
      const runRoot = positional(1)[0];
      return printResult(resumeRun({ runRoot }));
    }

    if (command === 'cancel') {
      const runRoot = positional(1)[0];
      return printResult(cancelRun({ runRoot, reason: value('--reason') }));
    }

    if (command === 'verify') {
      const runRoot = positional(1)[0];
      return printResult(verifyRun({ runRoot }));
    }

    if (command === 'report') {
      const runRoot = positional(1)[0];
      return printResult(buildCompletionPacket({ runRoot, format: value('--format') || 'json' }));
    }

    if (command === 'doctor') {
      return printResult(doctor({ executionPlane: has('--execution-plane'), config: configFromFlags() }));
    }

    if (command === 'replay') {
      const runRoot = positional(1)[0];
      return printResult(replayRun({ runRoot, verifyOnly: has('--verify-only') || true }));
    }
  } catch (error) {
    return printResult(errorResult(command, error));
  }
}

main();
