#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOperatorDashboard,
  buildSyntheticLaborOsAudit,
  loadSyntheticLaborOsJobs,
  renderOperatorDashboardMarkdown,
  writeOperatorDashboard
} from '../../packages/synthetic-labor-os/index.mjs';

export {
  buildOperatorDashboard,
  loadSyntheticLaborOsJobs,
  renderOperatorDashboardMarkdown,
  writeOperatorDashboard
} from '../../packages/synthetic-labor-os/index.mjs';

function parseArgs(argv) {
  const args = {
    artifactRoot: null,
    jobsDir: null,
    workspaceRoot: null,
    format: 'json',
    write: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--jobs-dir') { args.jobsDir = next; index += 1; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--format') { args.format = next; index += 1; continue; }
    if (token === '--markdown') { args.format = 'markdown'; continue; }
    if (token === '--json') { args.format = 'json'; continue; }
    if (token === '--no-write') { args.write = false; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/operator-dashboard.mjs [--artifact-root ROOT] [--jobs-dir DIR] [--workspace-root ROOT] [--format json|markdown] [--no-write]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function defaultWorkspaceRoot() {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'large-project-capability-stack') return path.resolve(cwd, '..');
  return cwd;
}

function optionalJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactRoot = path.resolve(args.artifactRoot || process.env.SYNTHETIC_LABOR_OS_ARTIFACT_ROOT || 'artifacts/synthetic-labor-os-v0/latest');
  const jobsDir = path.resolve(args.jobsDir || path.join(artifactRoot, 'jobs'));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const capabilityAudit = optionalJson(path.join(artifactRoot, 'capability_matrix.json')) || buildSyntheticLaborOsAudit({ workspaceRoot });
  const jobs = loadSyntheticLaborOsJobs({ jobsDir });
  const executionRegistry = optionalJson(path.join(artifactRoot, 'execution_plane_registry.json'));
  const demoProof = optionalJson(path.join(artifactRoot, 'demo_proof.json'));
  const scaleProof = optionalJson(path.join(artifactRoot, '100_agent_scale_proof.json'));
  const dashboard = buildOperatorDashboard({
    jobs,
    capabilityAudit,
    executionPlanes: executionRegistry?.planes || [],
    health: {
      demoProofThresholdPass: demoProof?.thresholdPass ?? null,
      scaleProofAdmitted: scaleProof?.admitted ?? null
    }
  });
  const written = args.write ? writeOperatorDashboard({ dashboard, artifactRoot }) : null;

  if (args.format === 'markdown') {
    process.stdout.write(renderOperatorDashboardMarkdown(dashboard));
  } else {
    console.log(JSON.stringify({ ...dashboard, written }, null, 2));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
