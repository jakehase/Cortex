#!/usr/bin/env node
import path from 'node:path';
import {
  buildSyntheticLaborOsAudit,
  renderSyntheticLaborOsAuditMarkdown,
  writeSyntheticLaborOsAudit
} from '../../packages/synthetic-labor-os/index.mjs';

function parseArgs(argv) {
  const args = {
    workspaceRoot: null,
    artifactRoot: null,
    format: 'json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--format') { args.format = next; index += 1; continue; }
    if (token === '--markdown') { args.format = 'markdown'; continue; }
    if (token === '--json') { args.format = 'json'; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/system-benchmark/audit-synthetic-labor-os-v0.mjs [--workspace-root ROOT] [--artifact-root ROOT] [--format json|markdown]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function defaultWorkspaceRoot() {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'large-project-capability-stack') return path.resolve(cwd, '..');
  if (path.basename(path.dirname(cwd)) === 'large-project-capability-stack') return path.resolve(cwd, '../..');
  return cwd;
}

const args = parseArgs(process.argv.slice(2));
const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
const audit = buildSyntheticLaborOsAudit({ workspaceRoot });

let written = null;
if (args.artifactRoot) {
  written = writeSyntheticLaborOsAudit({ audit, artifactRoot: path.resolve(args.artifactRoot) });
}

if (args.format === 'markdown') {
  process.stdout.write(renderSyntheticLaborOsAuditMarkdown(audit));
} else {
  console.log(JSON.stringify({ ...audit, written }, null, 2));
}
