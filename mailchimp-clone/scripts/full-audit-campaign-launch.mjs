import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { archiveArtifactRoots } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const archived = archiveArtifactRoots({
  repoRoot: ROOT,
  archiveBaseDir: path.join('artifacts', 'reruns'),
  artifactRoots: [
    path.join('artifacts', 'full_audit_campaign'),
    path.join('artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline')
  ],
  stamp: new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
});

const run = (script) => spawnSync(process.execPath, [script], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit'
});

const worker = run('scripts/full-audit-campaign-worker-100-agent.mjs');
const supervisor = run('scripts/full-audit-campaign-supervisor.mjs');
const watcher = run('scripts/full-audit-campaign-watch.mjs');

console.log(JSON.stringify({
  archiveRoot: path.relative(ROOT, archived.archiveRoot),
  archivedCount: archived.archived.length,
  workerExitCode: worker.status,
  supervisorExitCode: supervisor.status,
  watcherExitCode: watcher.status
}, null, 2));

process.exit(worker.status || supervisor.status || watcher.status || 0);
