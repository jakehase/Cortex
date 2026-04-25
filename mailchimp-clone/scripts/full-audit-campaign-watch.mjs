import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchCampaignReadiness } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { resolveProgramPaths, resolveProgramScriptArg } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const paths = resolveProgramPaths(ROOT);

const { ready, program, summary } = watchCampaignReadiness({
  programStatePath: paths.programStatePath,
  summaryPath: paths.summaryPath,
  notifyStatePath: paths.notifyPath,
  cwd: ROOT,
  notifyArgs: [resolveProgramScriptArg('notify')]
});

console.log(JSON.stringify({ ready, supervisor: program?.supervisor || null, summary }, null, 2));
process.exit(ready ? 0 : 1);
