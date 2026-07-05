#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvePatch,
  createReviewRequest,
  pauseJob,
  recordReviewDecision,
  rejectPatch,
  requestHumanReview,
  resumeJob
} from '../../packages/synthetic-labor-os/index.mjs';

export {
  approvePatch,
  createReviewRequest,
  pauseJob,
  recordReviewDecision,
  rejectPatch,
  requestHumanReview,
  resumeJob
} from '../../packages/synthetic-labor-os/index.mjs';

const ACTIONS = new Set(['pause', 'resume', 'request-review', 'approve-patch', 'reject-patch', 'changes-requested']);

function parseArgs(argv) {
  const args = {
    action: null,
    jobPath: null,
    actor: 'operator',
    reason: null,
    patchId: null,
    claimId: null,
    reviewId: null,
    to: 'running',
    artifactRefs: [],
    scope: [],
    write: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (ACTIONS.has(token)) { args.action = token; continue; }
    if (token === '--job') { args.jobPath = next; index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--reason' || token === '--rationale') { args.reason = next; index += 1; continue; }
    if (token === '--patch-id') { args.patchId = next; index += 1; continue; }
    if (token === '--claim-id') { args.claimId = next; index += 1; continue; }
    if (token === '--review-id') { args.reviewId = next; index += 1; continue; }
    if (token === '--to') { args.to = next; index += 1; continue; }
    if (token === '--artifact') { args.artifactRefs.push(next); index += 1; continue; }
    if (token === '--scope') { args.scope.push(next); index += 1; continue; }
    if (token === '--no-write') { args.write = false; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/operator-console.mjs pause --job JOB_JSON [--reason TEXT]
  node apps/synthetic-labor-os/operator-console.mjs resume --job JOB_JSON [--to running|queued]
  node apps/synthetic-labor-os/operator-console.mjs request-review --job JOB_JSON --patch-id PATCH [--artifact PATH]
  node apps/synthetic-labor-os/operator-console.mjs approve-patch --job JOB_JSON --patch-id PATCH [--scope SCOPE]
  node apps/synthetic-labor-os/operator-console.mjs reject-patch --job JOB_JSON --patch-id PATCH [--reason TEXT]

All actions are local control-plane records only. They do not merge, publish, send externally, or prove completion.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.action) throw new Error(`action is required: ${Array.from(ACTIONS).join(', ')}`);
  if (!args.jobPath) throw new Error('--job JOB_JSON is required');
  return args;
}

function loadJob(jobPath) {
  return JSON.parse(fs.readFileSync(jobPath, 'utf8'));
}

function writeJob(jobPath, job) {
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
}

function applyAction(job, args) {
  const common = {
    actor: args.actor,
    reason: args.reason,
    patchId: args.patchId,
    claimId: args.claimId,
    id: args.reviewId || undefined,
    artifactRefs: args.artifactRefs,
    scope: args.scope,
    rationale: args.reason
  };

  if (args.action === 'pause') {
    return pauseJob(job, { actor: args.actor, reason: args.reason || 'operator_console_pause' });
  }
  if (args.action === 'resume') {
    return resumeJob(job, { actor: args.actor, reason: args.reason || 'operator_console_resume', to: args.to });
  }
  if (args.action === 'request-review') {
    return requestHumanReview(job, { ...common, requestedAction: 'review_patch' });
  }
  if (args.action === 'approve-patch') {
    return approvePatch(job, common);
  }
  if (args.action === 'reject-patch') {
    return rejectPatch(job, common);
  }
  if (args.action === 'changes-requested') {
    return rejectPatch(job, { ...common, decision: 'changes_requested', requestedAction: 'request_patch_changes' });
  }
  throw new Error(`unsupported action: ${args.action}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobPath = path.resolve(args.jobPath);
  const before = loadJob(jobPath);
  const after = applyAction(before, args);
  if (args.write) writeJob(jobPath, after);
  console.log(JSON.stringify({
    ok: true,
    action: args.action,
    jobPath,
    written: args.write,
    job: after,
    truthBoundary: 'Operator console writes local OS control-plane records only; it does not merge, publish, send externally, or prove completion.'
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
