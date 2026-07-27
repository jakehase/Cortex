#!/usr/bin/env node
import { preflightLeanProofKernel } from './lean-proof-preflight.mjs';

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') continue;
    if (flag === '--kernel-root' && argv[index + 1]) {
      options.proofKernelRoot = argv[index += 1];
      continue;
    }
    if (flag === '--lean-root' && argv[index + 1]) {
      options.leanRoot = argv[index += 1];
      continue;
    }
    throw new Error(`unsupported preflight argument: ${flag}`);
  }
  return options;
}

try {
  const result = preflightLeanProofKernel(parseCli(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'absent') process.exitCode = 3;
  else if (!result.ready) process.exitCode = 4;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
