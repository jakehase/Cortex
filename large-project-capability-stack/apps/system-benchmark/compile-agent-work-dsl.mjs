#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeAgentWorkCompilation } from '../../packages/agent-work-dsl/index.mjs';

function usage() {
  console.error('usage: node apps/system-benchmark/compile-agent-work-dsl.mjs <agent-work-spec.{aw,json}> --out <artifact-dir> [--repo <repo-path>] [--run-id <id>]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const specPath = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv.shift()) : null;
let outputDir = '';
const options = {};
for (let index = 0; index < argv.length; index += 1) {
  const token = argv[index];
  if (token === '--out') outputDir = path.resolve(argv[++index] || '');
  else if (token === '--repo') options.repoPath = path.resolve(argv[++index] || '');
  else if (token === '--run-id') options.runId = argv[++index] || '';
  else if (token === '--artifact-root') options.artifactRoot = argv[++index] || '';
  else if (token === '--reply-anchor') options.replyAnchor = argv[++index] || '';
  else usage();
}
if (!specPath || !fs.existsSync(specPath) || !outputDir) usage();

const inputText = fs.readFileSync(specPath, 'utf8');
const input = specPath.endsWith('.json') ? JSON.parse(inputText) : inputText;
const compilation = writeAgentWorkCompilation({ input, outputDir, options });
console.log(JSON.stringify({
  ok: true,
  goalId: compilation.spec.goalId,
  runId: compilation.runContract.runId,
  runContractPath: compilation.files.runContractPath,
  surfaceMatrixPath: compilation.files.surfaceMatrixPath,
  workGraphPath: compilation.files.workGraphPath,
  compilerReportPath: compilation.files.compilerReportPath,
  defaultRunner: compilation.runtime.defaultRunner,
  defaultCommand: compilation.runtime.defaultCommand,
  relaunchAllowed: compilation.safetyReport.relaunchAllowed
}, null, 2));
