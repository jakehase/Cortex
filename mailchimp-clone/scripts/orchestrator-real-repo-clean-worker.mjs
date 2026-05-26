import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') args.assignment = argv[index + 1];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiresExecutableTestEvidence(assignment = {}) {
  const verifierRequirements = new Set([
    ...(Array.isArray(assignment?.shard?.requiredVerifiers) ? assignment.shard.requiredVerifiers : []),
    ...(Array.isArray(assignment?.assignmentContract?.verifierRequirements) ? assignment.assignmentContract.verifierRequirements : []),
    ...(Array.isArray(assignment?.contextPack?.assignmentContract?.verifierRequirements) ? assignment.contextPack.assignmentContract.verifierRequirements : [])
  ].map((entry) => String(entry || '').trim()).filter(Boolean));
  if (!verifierRequirements.has('tests') && !verifierRequirements.has('test')) return false;

  const successPredicate = [
    ...(Array.isArray(assignment?.assignmentContract?.successPredicate) ? assignment.assignmentContract.successPredicate : []),
    ...(Array.isArray(assignment?.contextPack?.assignmentContract?.successPredicate) ? assignment.contextPack.assignmentContract.successPredicate : []),
    ...(Array.isArray(assignment?.contextPack?.acceptanceChecks) ? assignment.contextPack.acceptanceChecks : [])
  ].map((entry) => String(entry || ''));

  return Boolean(
    assignment?.shard?.metadata?.strictGap
    || assignment?.contextPack?.shard?.surfaceIds?.length
    || assignment?.shard?.metadata?.testFile
    || (assignment?.shard?.metadata?.extraTestFiles || []).length
    || successPredicate.some((entry) => /produce executable evidence/i.test(entry))
  );
}

function verifierSubprocessEnv() {
  const existing = String(process.env.NODE_OPTIONS || '').trim();
  const verifierHeapMb = Math.max(512, Number(process.env.ORCHESTRATOR_VERIFIER_HEAP_MB || process.env.ORCHESTRATOR_TEST_VERIFIER_HEAP_MB || 1024));
  const withoutHeapCap = existing
    .replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    ...process.env,
    NODE_OPTIONS: [withoutHeapCap, `--max-old-space-size=${verifierHeapMb}`].filter(Boolean).join(' ')
  };
}

function runVerifier(assignmentPath, assignment, verifier) {
  if (process.env.MAILCHIMP_PRODUCT_ONLY !== '0' && (verifier === 'tests' || verifier === 'test') && !requiresExecutableTestEvidence(assignment)) {
    return {
      verifier,
      ok: true,
      skipped: true,
      reason: 'product_only_mode',
      assignmentId: assignment?.id || null,
      startedAt: new Date().toISOString(),
      durationMs: 0,
    };
  }
  const command = [process.execPath, assignment.verifierScriptPath, '--assignment', assignmentPath, '--verifier', verifier];
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(command[0], command.slice(1), {
      cwd: assignment.workspacePath,
      encoding: 'utf8',
      stdio: 'pipe',
      env: verifierSubprocessEnv()
    });
    const parsed = JSON.parse(String(stdout).trim());
    return {
      ok: parsed.ok !== false,
      verifier,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      stdout: String(stdout).trim(),
      stderr: ''
    };
  } catch (error) {
    const stdout = `${error.stdout || ''}`.trim();
    const stderr = `${error.stderr || ''}${error.message || ''}`.trim();
    return {
      ok: false,
      verifier,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      stdout,
      stderr
    };
  }
}

function runImplementation(assignmentPath, assignment) {
  if (!assignment.implementationScriptPath) {
    return {
      ok: true,
      command: null,
      durationMs: 0,
      modifiedFiles: [],
      diffSummary: 'verification-only shard',
      stdout: '',
      stderr: '',
      metadata: {}
    };
  }

  const command = [process.execPath, assignment.implementationScriptPath, '--assignment', assignmentPath];
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(command[0], command.slice(1), {
      cwd: assignment.workspacePath,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const parsed = JSON.parse(String(stdout).trim() || '{}');
    return {
      ok: parsed.ok !== false,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      modifiedFiles: parsed.modifiedFiles || [],
      diff: parsed.diff || parsed.unifiedDiff || parsed.patch || '',
      unifiedDiff: parsed.unifiedDiff || parsed.diff || parsed.patch || '',
      diffSummary: parsed.diffSummary || 'implemented shard changes',
      stdout: String(stdout).trim(),
      stderr: '',
      metadata: parsed.metadata || {}
    };
  } catch (error) {
    const stdout = `${error.stdout || ''}`.trim();
    const stderr = `${error.stderr || ''}${error.message || ''}`.trim();
    return {
      ok: false,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      modifiedFiles: [],
      diffSummary: 'implementation failed',
      stdout,
      stderr,
      metadata: {}
    };
  }
}

function snapshotAllowedFiles(assignment) {
  const workspacePath = assignment.workspacePath;
  const allowedFiles = [...new Set((assignment.shard?.allowedFiles || [])
    .filter((entry) => /\.(mjs|js|json|css|html)$/.test(String(entry || ''))))];
  const snapshot = new Map();
  for (const rel of allowedFiles) {
    const filePath = path.join(workspacePath, rel);
    snapshot.set(rel, {
      filePath,
      existed: fs.existsSync(filePath),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
    });
  }
  return snapshot;
}

function restoreModifiedFiles(snapshot, modifiedFiles = null) {
  const restoreList = modifiedFiles && modifiedFiles.length ? modifiedFiles : [...snapshot.keys()];
  for (const rel of [...new Set(restoreList)]) {
    const entry = snapshot.get(rel);
    if (!entry) continue;
    if (entry.existed) {
      fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
      fs.writeFileSync(entry.filePath, entry.content);
    } else if (fs.existsSync(entry.filePath)) {
      fs.unlinkSync(entry.filePath);
    }
  }
}

function implementationAdmissionFailure(implementation = {}) {
  const metadata = implementation.metadata || {};
  const architectureEvidence = metadata.architectureEvidence || null;
  const semanticBloatAudit = metadata.semanticBloatAudit || architectureEvidence?.semanticBloatAudit || null;
  if (semanticBloatAudit?.semanticBloatSuspect === true) {
    return { reason: 'semantic_bloat_product_delta', architectureEvidence, semanticBloatAudit };
  }
  if (process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT === '1' && architectureEvidence && architectureEvidence.ok !== true) {
    return { reason: architectureEvidence.reason || 'missing_concrete_runtime_delta', architectureEvidence, semanticBloatAudit };
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
if (!args.assignment) {
  console.error('missing --assignment');
  process.exit(1);
}

const assignment = JSON.parse(fs.readFileSync(args.assignment, 'utf8'));
const failureInjection = assignment.failureInjection || null;
const startedAt = Date.now();
const workspaceSnapshot = snapshotAllowedFiles(assignment);
fs.mkdirSync(path.dirname(assignment.resultPath), { recursive: true });
fs.mkdirSync(path.dirname(assignment.logPath), { recursive: true });

if (failureInjection?.mode === 'crash') {
  fs.appendFileSync(assignment.logPath, `[crash-injection] ${failureInjection.note || 'deterministic crash'}\n`);
  process.exit(85);
}

if (failureInjection?.mode === 'stall') {
  fs.appendFileSync(assignment.logPath, `[stall-injection] ${failureInjection.note || 'deterministic stall'} delayMs=${failureInjection.delayMs || 0}\n`);
  await sleep(Number(failureInjection.delayMs || 0));
}

const implementation = runImplementation(args.assignment, assignment);
fs.appendFileSync(assignment.logPath, `${JSON.stringify({ type: 'implementation', ...implementation })}\n`);
if (implementation.ok === false) {
  restoreModifiedFiles(workspaceSnapshot);
  fs.writeFileSync(assignment.resultPath, JSON.stringify({
    ok: false,
    shardId: assignment.shard.id,
    leaseId: assignment.lease.leaseId,
    agentId: assignment.agentId,
    executionMode: assignment.executionMode,
    implementation,
    verifierResults: [],
    elapsedMs: Date.now() - startedAt
  }, null, 2));
  process.exit(2);
}

const admissionFailure = implementationAdmissionFailure(implementation);
if (admissionFailure) {
  restoreModifiedFiles(workspaceSnapshot, implementation.modifiedFiles);
  fs.writeFileSync(assignment.resultPath, JSON.stringify({
    ok: false,
    shardId: assignment.shard.id,
    leaseId: assignment.lease.leaseId,
    agentId: assignment.agentId,
    executionMode: assignment.executionMode,
    implementation,
    verifierResults: [],
    admissionFailure,
    elapsedMs: Date.now() - startedAt
  }, null, 2));
  process.exit(2);
}

const verifierResults = [];
for (const verifier of assignment.shard.requiredVerifiers || []) {
  const result = runVerifier(args.assignment, assignment, verifier);
  verifierResults.push(result);
  fs.appendFileSync(assignment.logPath, `${JSON.stringify(result)}\n`);
  if (result.ok === false) {
    restoreModifiedFiles(workspaceSnapshot);
    fs.writeFileSync(assignment.resultPath, JSON.stringify({
      ok: false,
      shardId: assignment.shard.id,
      leaseId: assignment.lease.leaseId,
      agentId: assignment.agentId,
      executionMode: assignment.executionMode,
      implementation,
      verifierResults,
      elapsedMs: Date.now() - startedAt
    }, null, 2));
    process.exit(2);
  }
}

fs.writeFileSync(assignment.resultPath, JSON.stringify({
  ok: true,
  shardId: assignment.shard.id,
  leaseId: assignment.lease.leaseId,
  agentId: assignment.agentId,
  executionMode: assignment.executionMode,
  implementation,
  verifierResults,
  elapsedMs: Date.now() - startedAt,
  contextPack: {
    shardId: assignment.contextPack?.shard?.id || assignment.shard.id,
    guardrails: assignment.contextPack?.guardrails || null,
    acceptanceChecks: assignment.contextPack?.acceptanceChecks || []
  }
}, null, 2));
console.log(JSON.stringify({ ok: true, shardId: assignment.shard.id, leaseId: assignment.lease.leaseId }));
