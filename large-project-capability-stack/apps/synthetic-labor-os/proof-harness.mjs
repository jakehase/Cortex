#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admitHundredAgentScaleProof,
  buildCleanV0DemoProof,
  buildOperatorDashboard,
  buildSyntheticLaborOsAudit,
  loadSyntheticLaborOsJobs,
  renderOperatorDashboardMarkdown,
  renderSyntheticLaborOsAuditMarkdown,
  transitionJob,
  writeCleanV0DemoProof,
  writeHundredAgentScaleProof,
  writeOperatorDashboard,
  writeSyntheticLaborOsAudit
} from '../../packages/synthetic-labor-os/index.mjs';

export {
  admitHundredAgentScaleProof,
  buildCleanV0DemoProof,
  writeCleanV0DemoProof,
  writeHundredAgentScaleProof
} from '../../packages/synthetic-labor-os/index.mjs';

const ACTIONS = new Set(['demo', 'scale', 'all']);

function defaultWorkspaceRoot() {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'large-project-capability-stack') return path.resolve(cwd, '..');
  if (path.basename(path.dirname(cwd)) === 'large-project-capability-stack') return path.resolve(cwd, '../..');
  return cwd;
}

function defaultScaleSourceRoot(workspaceRoot) {
  return path.join(
    workspaceRoot,
    'artifacts/benchmarks/agent_work_default_path_model_100agent_30m/agent-work-default-path-model-100agent-30m-official-20260613T141349Z'
  );
}

function parseArgs(argv) {
  const args = {
    action: 'all',
    workspaceRoot: null,
    artifactRoot: null,
    scaleSourceRoot: null,
    format: 'json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (ACTIONS.has(token)) { args.action = token; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--scale-source-root') { args.scaleSourceRoot = next; index += 1; continue; }
    if (token === '--format') { args.format = next; index += 1; continue; }
    if (token === '--markdown') { args.format = 'markdown'; continue; }
    if (token === '--json') { args.format = 'json'; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/proof-harness.mjs [demo|scale|all] [--artifact-root ROOT] [--workspace-root ROOT] [--scale-source-root ROOT] [--format json|markdown]

The demo proof is local/deterministic. The scale proof only admits existing verified execution-plane artifacts; it does not launch workers.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function resolveProofBlockerJobs({ artifactRoot, demoProof, scaleProof }) {
  if (demoProof?.thresholdPass !== true || scaleProof?.admitted !== true) return [];
  const jobsDir = path.join(artifactRoot, 'jobs');
  if (!fs.existsSync(jobsDir)) return [];
  const resolved = [];
  for (const entry of fs.readdirSync(jobsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const jobPath = path.join(jobsDir, entry.name);
    const job = readJson(jobPath, null);
    if (job?.state !== 'blocked') continue;
    if (job.blocker?.blockerKind !== 'missing_v0_demo_and_scale_proof') continue;
    const compiled = transitionJob(job, {
      to: 'compiled',
      actor: 'synthetic-labor-os-proof-harness',
      reason: 'proof_blocker_resolved_demo_and_scale_artifacts_present',
      blocker: null
    });
    const queued = transitionJob(compiled, { to: 'queued', actor: 'synthetic-labor-os-proof-harness', reason: 'resolved_blocker_job_queued_for_closure' });
    const running = transitionJob(queued, { to: 'running', actor: 'synthetic-labor-os-proof-harness', reason: 'resolved_blocker_job_closure_started' });
    const completed = transitionJob(running, {
      to: 'completed',
      actor: 'synthetic-labor-os-proof-harness',
      reason: 'resolved_blocker_job_closed_after_demo_and_scale_proofs',
      artifacts: {
        completionSummary: {
          schemaVersion: 'claw.synthetic_labor_os.v0.productization_blocker_resolution',
          generatedAt: new Date().toISOString(),
          thresholdPass: true,
          demoProofThresholdPass: true,
          scaleProofAdmitted: true,
          truthBoundary: 'This closes the prior local productization-shell blocker because the missing demo and scale proof artifacts now exist. It does not expand the proof beyond their declared scopes.'
        }
      }
    });
    fs.writeFileSync(jobPath, `${JSON.stringify(completed, null, 2)}\n`);
    resolved.push({ jobId: completed.id, jobPath });
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const artifactRoot = path.resolve(args.artifactRoot || process.env.SYNTHETIC_LABOR_OS_ARTIFACT_ROOT || 'artifacts/synthetic-labor-os-v0/latest');
  const scaleSourceRoot = path.resolve(args.scaleSourceRoot || process.env.SYNTHETIC_LABOR_OS_SCALE_SOURCE_ROOT || defaultScaleSourceRoot(workspaceRoot));

  const result = {
    ok: true,
    action: args.action,
    workspaceRoot,
    artifactRoot,
    wrote: {},
    truthBoundary: 'Synthetic Labor OS proof harness writes local artifacts only. It does not merge, publish, send externally, or launch heavy workers.'
  };

  let demoProof = null;
  let scaleProof = null;

  if (args.action === 'demo' || args.action === 'all') {
    demoProof = buildCleanV0DemoProof({ workspaceRoot, artifactRoot });
    result.wrote.demo = writeCleanV0DemoProof({ proof: demoProof, artifactRoot });
    result.demo = {
      thresholdPass: demoProof.thresholdPass,
      proofKind: demoProof.proofKind,
      truthBoundary: demoProof.truthBoundary
    };
  }

  if (args.action === 'scale' || args.action === 'all') {
    scaleProof = admitHundredAgentScaleProof({ sourceRoot: scaleSourceRoot });
    result.wrote.scale = writeHundredAgentScaleProof({ proof: scaleProof, artifactRoot });
    result.scale = {
      admitted: scaleProof.admitted,
      thresholdPass: scaleProof.thresholdPass,
      metrics: scaleProof.metrics,
      failures: scaleProof.failures,
      truthBoundary: scaleProof.truthBoundary
    };
    if (!scaleProof.admitted) result.ok = false;
  } else {
    scaleProof = readJson(path.join(artifactRoot, '100_agent_scale_proof.json'), null);
  }

  result.wrote.resolvedProofBlockers = resolveProofBlockerJobs({ artifactRoot, demoProof: demoProof || readJson(path.join(artifactRoot, 'demo_proof.json'), null), scaleProof });

  const audit = buildSyntheticLaborOsAudit({ workspaceRoot });
  result.wrote.audit = writeSyntheticLaborOsAudit({ audit, artifactRoot });
  const jobs = loadSyntheticLaborOsJobs({ jobsDir: path.join(artifactRoot, 'jobs') });
  const executionRegistry = readJson(path.join(artifactRoot, 'execution_plane_registry.json'), null);
  const dashboard = buildOperatorDashboard({
    jobs,
    capabilityAudit: audit,
    executionPlanes: executionRegistry?.planes || [],
    health: {
      demoProofThresholdPass: demoProof?.thresholdPass ?? readJson(path.join(artifactRoot, 'demo_proof.json'), {})?.thresholdPass ?? null,
      scaleProofAdmitted: scaleProof?.admitted ?? null
    }
  });
  result.wrote.dashboard = writeOperatorDashboard({ dashboard, artifactRoot });
  result.auditSummary = audit.summary;
  result.dashboard = {
    jobCount: dashboard.jobCount,
    attentionJobCount: dashboard.attentionJobCount,
    v0ProductReady: dashboard.v0ProductReady,
    truthBoundary: dashboard.truthBoundary
  };

  if (args.format === 'markdown') {
    process.stdout.write(`${renderSyntheticLaborOsAuditMarkdown(audit)}\n${renderOperatorDashboardMarkdown(dashboard)}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!result.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
