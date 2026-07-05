#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createJob,
  transitionJob,
  writeSyntheticLaborOsJob
} from '../../packages/synthetic-labor-os/index.mjs';

export { createJob, transitionJob, writeSyntheticLaborOsJob } from '../../packages/synthetic-labor-os/index.mjs';

function parseArgs(argv) {
  const args = {
    action: 'create',
    artifactRoot: null,
    jobsDir: null,
    jobPath: null,
    objective: null,
    repoPath: null,
    fidelity: 'production_slice',
    requestedAgentCount: null,
    to: null,
    reason: null,
    actor: 'operator'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === 'create' || token === 'transition') { args.action = token; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--jobs-dir') { args.jobsDir = next; index += 1; continue; }
    if (token === '--job') { args.jobPath = next; index += 1; continue; }
    if (token === '--objective') { args.objective = next; index += 1; continue; }
    if (token === '--repo') { args.repoPath = next; index += 1; continue; }
    if (token === '--fidelity') { args.fidelity = next; index += 1; continue; }
    if (token === '--agents') { args.requestedAgentCount = Number(next); index += 1; continue; }
    if (token === '--to') { args.to = next; index += 1; continue; }
    if (token === '--reason') { args.reason = next; index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage:\n  node apps/synthetic-labor-os/job-lifecycle.mjs create --artifact-root ROOT --objective TEXT [--repo PATH] [--fidelity production_slice] [--agents N]\n  node apps/synthetic-labor-os/job-lifecycle.mjs transition --job JOB_JSON --to STATE [--reason TEXT]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

async function main() {
  const fs = await import('node:fs');
  const args = parseArgs(process.argv.slice(2));
  const artifactRoot = path.resolve(args.artifactRoot || process.env.SYNTHETIC_LABOR_OS_ARTIFACT_ROOT || 'artifacts/synthetic-labor-os-v0/latest');
  const jobsDir = path.resolve(args.jobsDir || path.join(artifactRoot, 'jobs'));

  if (args.action === 'create') {
    const job = createJob({
      objective: args.objective || 'Synthetic Labor OS v0 job lifecycle shell',
      repoPath: args.repoPath || null,
      fidelity: args.fidelity,
      requestedAgentCount: args.requestedAgentCount,
      artifactRoot,
      createdBy: args.actor,
      reason: 'operator_job_created'
    });
    const written = writeSyntheticLaborOsJob({ job, jobsDir });
    console.log(JSON.stringify({ ok: true, action: 'create', job, written }, null, 2));
    return;
  }

  if (args.action === 'transition') {
    if (!args.jobPath) throw new Error('--job is required for transition');
    if (!args.to) throw new Error('--to is required for transition');
    const jobPath = path.resolve(args.jobPath);
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    const next = transitionJob(job, { to: args.to, reason: args.reason || 'operator_transition', actor: args.actor });
    fs.writeFileSync(jobPath, JSON.stringify(next, null, 2));
    console.log(JSON.stringify({ ok: true, action: 'transition', jobPath, job: next }, null, 2));
    return;
  }

  throw new Error(`unsupported action: ${args.action}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
