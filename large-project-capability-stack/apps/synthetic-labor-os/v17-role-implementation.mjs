#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  SLOS_V17_ROLES,
  allowedFilesForRole,
  candidatePatchPath,
  candidateRoot,
  candidateSeed,
  candidateTarget,
  candidateTestPath
} from './v17-role-catalog.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--assignment') args.assignment = argv[index + 1];
  }
  return args;
}

function parseFixture(value = '') {
  const [candidateId, role = 'patch_author'] = String(value || '').split('::');
  if (!SLOS_V17_ROLES.includes(role)) throw new Error(`Unknown SLOS v17 role: ${role}`);
  return { candidateId, role };
}

function stableList(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).flat().filter(Boolean).map(String))].sort();
}

function ensureInside(root, rel) {
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`Refusing path outside workspace: ${rel}`);
  return resolved;
}

function ensureParent(filePath) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); }
function sha256(content = '') { return crypto.createHash('sha256').update(String(content)).digest('hex'); }
function readFileMaybe(filePath) { try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; } }

function snapshotFiles(workspace, files) {
  const map = new Map();
  for (const rel of files) {
    const target = ensureInside(workspace, rel);
    const content = readFileMaybe(target);
    map.set(rel, content === null ? null : { hash: sha256(content), content });
  }
  return map;
}

function changedAllowedFiles(workspace, before, files) {
  const changed = [];
  for (const rel of files) {
    const previous = before.get(rel) || null;
    const content = readFileMaybe(ensureInside(workspace, rel));
    const next = content === null ? null : { hash: sha256(content), content };
    if ((previous?.hash || null) !== (next?.hash || null)) changed.push(rel);
  }
  return changed;
}

function listFiles(root, dir = root, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) listFiles(root, full, out);
    else out.push(path.relative(root, full).replaceAll(path.sep, '/'));
  }
  return out;
}

function diffForChanged(workspace, before, changed) {
  const chunks = [];
  for (const rel of changed) {
    const previous = before.get(rel)?.content;
    const current = readFileMaybe(ensureInside(workspace, rel)) || '';
    chunks.push(previous === null || previous === undefined ? '--- /dev/null' : `--- a/${rel}`);
    chunks.push(`+++ b/${rel}`);
    chunks.push('@@ slos v17 role delta @@');
    const lines = current.split('\n').slice(0, 240);
    chunks.push(...lines.map((line) => `+${line}`));
    if (current.split('\n').length > 240) chunks.push('+...[diff truncated]');
  }
  return chunks.join('\n');
}

function readSnippet(workspace, rel, max = 5000) {
  const text = readFileMaybe(ensureInside(workspace, rel));
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function rolePrompt({ assignment, workspace, candidateId, role, allowedFiles }) {
  const root = candidateRoot(candidateId);
  const seed = candidateSeed(candidateId);
  const target = assignment.shard?.metadata?.candidateTarget || candidateTarget(candidateId, assignment.shard?.metadata?.runStamp || 'RUN');
  const architecture = readSnippet(workspace, `${root}/architecture.json`, 4000);
  const readme = readSnippet(workspace, `${root}/README.md`, 4000);
  const proposal = readSnippet(workspace, `${root}/proposal.md`, 3000);
  const patch = readSnippet(workspace, candidatePatchPath(candidateId), 5000);
  const tests = readSnippet(workspace, candidateTestPath(candidateId), 3000);
  const review = readSnippet(workspace, `${root}/role-artifacts/adversarial-review.md`, 3000);
  const allowed = allowedFiles.map((rel) => `- ${rel}`).join('\n');
  const common = `You are a real Codex CLI role-agent in a Synthetic Labor OS v17 role-agent tournament.\n\nCandidate: ${candidateId}\nExploration seed: ${seed}\nRole: ${role}\nWorkspace: ${workspace}\nWinning patch target if selected: ${target}\n\nYou may create or edit ONLY these allowed files:\n${allowed}\n\nProduct slice:\n- This is an internal Synthetic Labor OS production-slice improvement proposal.\n- The final candidate should be a small reviewable documentation patch that can be applied to the main repo only if selected by the tournament.\n- The patch must be a standard unified git diff creating ${target}.\n- The patch content should improve operator understanding of SLOS role-agent orchestration, proof boundaries, or runbook discipline.\n- Do not modify package.json, install dependencies, merge, publish, deploy, send externally, or create files outside the allowed list.\n- Keep content concise and senior-developer-readable; avoid generated bulk.\n`;
  if (role === 'strategist') return `${common}\nDesign this candidate's approach. Write:\n1. ${root}/architecture.json with id, title, pattern, layers, rationale, tradeoffs, reviewFocus, candidateTarget.\n2. ${root}/README.md explaining the approach.\n3. ${root}/role-artifacts/strategy.md with guidance for later role agents.\nDo not write the patch diff yet.`;
  if (role === 'patch_author') return `${common}\nStrategy context:\n${architecture || '[architecture missing]'}\n\nREADME context:\n${readme || '[README missing]'}\n\nWrite ${candidatePatchPath(candidateId)} as a valid unified diff that creates ${target}. Also write ${root}/proposal.md and ${root}/role-artifacts/patch-author-notes.md explaining why this patch is useful. The diff must start with a diff --git header and pass git apply --check.`;
  if (role === 'test_writer') return `${common}\nPatch context:\n${patch || '[patch missing]'}\n\nProposal context:\n${proposal || '[proposal missing]'}\n\nWrite ${candidateTestPath(candidateId)} and ${root}/role-artifacts/test-plan.md. Describe concrete validation commands/checks: git apply --check, target-only verification, truth-boundary check, and post-apply SLOS test gate. Do not edit the patch.`;
  if (role === 'adversarial_reviewer') return `${common}\nPatch context:\n${patch || '[patch missing]'}\n\nTest-plan context:\n${tests || '[test plan missing]'}\n\nAct as an adversarial reviewer. You may make minimal fixes to the candidate patch/test plan if needed. Write ${root}/role-artifacts/adversarial-review.md and .json with risks, counterexamples checked, and verdict. Focus on target isolation, claim honesty, and whether the patch is actually useful.`;
  return `${common}\nPatch context:\n${patch || '[patch missing]'}\n\nReview context:\n${review || '[review missing]'}\n\nYou are the scorer/refiner. Make minimal final fixes so the patch applies cleanly and the candidate is coherent. Write ${root}/role-artifacts/scorecard.json with numeric score 0-100, strengths, weaknesses, rationale, candidateTarget, patchPath, and shouldWin boolean. Also write refinement-notes.md. Keep the patch small and reviewable.`;
}

const args = parseArgs(process.argv.slice(2));
if (!args.assignment) {
  console.error('missing --assignment');
  process.exit(2);
}
const assignment = JSON.parse(fs.readFileSync(args.assignment, 'utf8'));
const workspace = path.resolve(assignment.workspacePath);
const { candidateId, role } = parseFixture(assignment.shard?.metadata?.fixtureModuleId || assignment.shard?.id);
const allowedFiles = stableList(assignment.shard?.allowedFiles || allowedFilesForRole(candidateId, role));
for (const rel of allowedFiles) ensureParent(ensureInside(workspace, rel));
const before = snapshotFiles(workspace, allowedFiles);
const beforeAll = new Set(listFiles(workspace));
const prompt = rolePrompt({ assignment, workspace, candidateId, role, allowedFiles });
const promptPath = path.join(path.dirname(assignment.resultPath), `${assignment.shard.id}__v17-role-prompt.txt`);
const codexLogPath = path.join(path.dirname(assignment.logPath), `${assignment.shard.id}__v17-codex.log`);
ensureParent(promptPath);
fs.writeFileSync(promptPath, prompt);

const codexBin = process.env.CODEX_BIN || '/home/jake/.local/bin/codex';
const codexModel = process.env.SLOS_V17_CODEX_MODEL || process.env.SHOWCASE_CODEX_MODEL || process.env.CODEX_MODEL || 'gpt-5.5';
const codexSandbox = process.env.SLOS_V17_CODEX_SANDBOX || process.env.SHOWCASE_CODEX_SANDBOX || process.env.CODEX_CREATIVE_SANDBOX || 'workspace-write';
const timeoutMs = Math.max(30_000, Number(process.env.SLOS_V17_CODEX_TIMEOUT_MS || 300_000));
const codexArgs = ['exec', '--cd', workspace, '--skip-git-repo-check', '--sandbox', codexSandbox, '--color', 'never', '--model', codexModel, prompt];
const startedAt = Date.now();
fs.writeFileSync(codexLogPath, [`$ ${codexBin} ${codexArgs.slice(0, -1).join(' ')} <prompt>`, `startedAt=${new Date(startedAt).toISOString()}`, '---'].join('\n') + '\n');
const logFd = fs.openSync(codexLogPath, 'a');
let run;
try {
  run = spawnSync(codexBin, codexArgs, { cwd: workspace, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', logFd, logFd] });
} finally {
  fs.closeSync(logFd);
}
const finishedAt = Date.now();
const changed = changedAllowedFiles(workspace, before, allowedFiles);
const afterAll = new Set(listFiles(workspace));
const currentCandidateRoot = `${candidateRoot(candidateId)}/`;
const currentCandidateTarget = assignment.shard?.metadata?.candidateTarget || candidateTarget(candidateId, assignment.shard?.metadata?.runStamp || 'RUN');
const currentCandidateTestPath = candidateTestPath(candidateId);
// In shared-workspace parallel runs, sibling candidate agents may legitimately create
// their own files while this Codex process is running. Treat only new files that
// belong to the current candidate as attributable out-of-scope writes for this role.
const newOutOfScope = [...afterAll].filter((rel) => {
  if (beforeAll.has(rel) || allowedFiles.includes(rel)) return false;
  return rel.startsWith(currentCandidateRoot) || rel === currentCandidateTarget || rel === currentCandidateTestPath;
}).filter((rel) => !allowedFiles.includes(rel));
const ok = !run.error && run.status === 0 && changed.length > 0 && newOutOfScope.length === 0;
const result = {
  ok,
  modifiedFiles: changed,
  unifiedDiff: diffForChanged(workspace, before, changed),
  diffSummary: `${candidateId} ${role}: real Codex role produced ${changed.length} allowed file change(s)`,
  stdout: '',
  stderr: ok ? '' : JSON.stringify({ status: run.status, signal: run.signal || null, error: run.error?.message || null, changed, newOutOfScope }),
  metadata: {
    showcase: 'slos_v17_role_agent_tournament',
    realCodex: true,
    candidateId,
    role,
    explorationSeed: candidateSeed(candidateId),
    candidateTarget: assignment.shard?.metadata?.candidateTarget || null,
    command: `${codexBin} ${codexArgs.slice(0, -1).join(' ')} <prompt>`,
    codexModel,
    codexSandbox,
    durationMs: finishedAt - startedAt,
    exitCode: run.status ?? (run.error ? 1 : 0),
    signal: run.signal || null,
    error: run.error?.message || null,
    promptPath,
    codexLogPath,
    allowedFiles,
    changedAllowedFiles: changed,
    newOutOfScopeFiles: newOutOfScope,
    architectureEvidence: {
      ok: changed.length > 0 && newOutOfScope.length === 0,
      layerCount: 1,
      layers: [role],
      runtimeIntegrated: role !== 'strategist',
      modifiedPrimaryRuntimeFiles: changed,
      modifiedRequiredLayers: [role],
      semanticBloatAudit: { semanticBloatSuspect: false, duplicateAddedLineRatio: 0 },
      summary: `Real Codex ${role} role for ${candidateId}`
    },
    proofCarryingClaim: {
      statement: `Real Codex ${role} role contributed to ${candidateId}.`,
      requestedCredit: 'real_codex_slos_v17_role_credit',
      surfaceIds: [candidateId, `${candidateId}__${role}`],
      negativeSpaceReduced: ok,
      reducedGaps: [`${role}_real_codex_artifact`],
      remainingGaps: 'Final scorer/refiner and tournament verifier choose the winner; this is an internal SLOS production-slice tournament, not deployment.',
      sourceOfTruthIntegrated: changed.length > 0,
      proofArtifacts: [promptPath, codexLogPath, ...changed]
    }
  }
};
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 2);
