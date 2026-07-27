#!/usr/bin/env node
import { runTransferQualification } from './transfer-qualification-worker.mjs';

const args = process.argv.slice(2);
function value(flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
  return args[index + 1];
}
function values(flag) {
  return args.flatMap((arg, index) => arg === flag ? [args[index + 1]] : []);
}

try {
  const artifacts = value('--artifacts');
  const model = value('--model');
  if (!artifacts || !model) throw new Error('usage: transfer:run -- --artifacts ROOT --model MODEL [--concurrency N] [--reasoning low] [--model-command PATH] [--model-arg ARG ...]');
  const suppliedArgs = values('--model-arg');
  const result = await runTransferQualification({
    artifactRoot: artifacts,
    model,
    concurrency: Number(value('--concurrency', '1')),
    modelCommand: value('--model-command', 'codex'),
    modelArgs: suppliedArgs.length ? suppliedArgs : null,
    reasoningEffort: value('--reasoning', 'low'),
    timeoutMs: Number(value('--timeout-ms', '300000')),
  });
  console.log(JSON.stringify({
    ok: true,
    runId: result.plan.runId,
    profileId: result.plan.profileId,
    model,
    calls: result.providerCalls.length,
    inert: true,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
