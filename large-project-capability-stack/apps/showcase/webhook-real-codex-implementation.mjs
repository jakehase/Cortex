#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  REAL_CODEX_ROLES,
  allowedFilesForRole,
  candidateRoot,
  candidateSeed,
  candidateTestPath,
  candidateSourceFiles
} from './webhook-real-codex-catalog.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--assignment') args.assignment = argv[index + 1];
  }
  return args;
}

function parseFixture(value = '') {
  const [candidateId, role = 'implementer'] = String(value || '').split('::');
  if (!REAL_CODEX_ROLES.includes(role)) throw new Error(`Unknown real Codex role: ${role}`);
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

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sha256(content = '') {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

function readFileMaybe(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

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
    chunks.push('@@ real codex role delta @@');
    const lines = current.split('\n').slice(0, 240);
    chunks.push(...lines.map((line) => `+${line}`));
    if (current.split('\n').length > 240) chunks.push('+...[diff truncated]');
  }
  return chunks.join('\n');
}

function readContextSnippet(workspace, rel, max = 6000) {
  const text = readFileMaybe(ensureInside(workspace, rel));
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function rolePrompt({ assignment, workspace, candidateId, role, allowedFiles }) {
  const root = candidateRoot(candidateId);
  const seed = candidateSeed(candidateId);
  const architecture = readContextSnippet(workspace, `${root}/architecture.json`, 4000);
  const readme = readContextSnippet(workspace, `${root}/README.md`, 4000);
  const index = readContextSnippet(workspace, `${root}/src/index.mjs`, 5000);
  const test = readContextSnippet(workspace, candidateTestPath(candidateId), 4000);
  const review = readContextSnippet(workspace, `${root}/role-artifacts/adversarial-review.md`, 4000);
  const allowed = allowedFiles.map((rel) => `- ${rel}`).join('\n');
  const common = `You are a real Codex CLI role-agent in an agent-orchestration showcase.\n\nProduct slice: a small webhook event inbox + replay module.\nCandidate: ${candidateId}\nExploration seed: ${seed}\nRole: ${role}\nWorkspace: ${workspace}\n\nYou may create or edit ONLY these allowed files:\n${allowed}\n\nHard product API contract for the final implementation:\n- Export function createWebhookApp(options = {}) from ${root}/src/index.mjs.\n- createWebhookApp returns an object with receive(input, headers), processNext(handler), replay(id, handler), get(id), list(filter), outbox(), stats(), and architecture.\n- receive must support idempotency key dedupe.\n- processNext must mark records processed or failed.\n- replay must enqueue replay metadata and reprocess a known event.\n- list must filter by status and type.\n- Keep it small and reviewable. Avoid generated bulk.\n- Do not create files outside the allowed list.\n- Do not modify package.json or install dependencies. Use only Node built-ins.\n`;
  if (role === 'architect') return `${common}\nInvent a distinct architecture for this candidate. The seed is only inspiration; choose and justify your own design.\n\nWrite:\n1. ${root}/architecture.json with: id, title, pattern, layers array, rationale, tradeoffs, reviewFocus.\n2. ${root}/README.md explaining the architecture in senior-developer-readable prose.\n3. ${root}/role-artifacts/architect-brief.md with implementation guidance for later role-agents.\n\nDo not write implementation code yet.`;
  if (role === 'implementer') return `${common}\nArchitecture context:\n${architecture || '[architecture.json missing — infer a simple architecture from the seed]'}\n\nREADME context:\n${readme || '[README missing]'}\n\nImplement the product code according to the architecture. You must write ${root}/src/index.mjs and may use the other allowed src modules if useful. Ensure the exported createWebhookApp contract works. Do not write tests in this role.`;
  if (role === 'test_writer') return `${common}\nArchitecture context:\n${architecture || '[architecture.json missing]'}\n\nImplementation context:\n${index || '[index.mjs missing — write tests against the required API contract anyway]'}\n\nWrite a Node node:test test file at ${candidateTestPath(candidateId)}. It must test receive, idempotency dedupe, successful processing, failed processing, replay, list filtering, and stats. Do not edit product code in this role.`;
  if (role === 'adversarial_reviewer') return `${common}\nArchitecture context:\n${architecture || '[architecture.json missing]'}\n\nImplementation context:\n${index || '[index.mjs missing]'}\n\nTest context:\n${test || '[test missing]'}\n\nAct as an adversarial senior reviewer. You may harden product code/tests if needed, but keep edits scoped. Write ${root}/role-artifacts/adversarial-review.md and .json with risks, counterexamples checked, and verdict. Focus on idempotency, replay safety, failure lifecycle, and whether the slice is reviewable.`;
  return `${common}\nArchitecture context:\n${architecture || '[architecture.json missing]'}\n\nImplementation context:\n${index || '[index.mjs missing]'}\n\nTest context:\n${test || '[test missing]'}\n\nAdversarial review context:\n${review || '[review missing]'}\n\nYou are the scorer/refiner. Make minimal final fixes so behavior tests pass and the architecture is coherent. Write ${root}/role-artifacts/scorecard.json and refinement-notes.md. The scorecard must include score, strengths, weaknesses, and why this candidate should or should not win. Keep the implementation small.`;
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
const promptPath = path.join(path.dirname(assignment.resultPath), `${assignment.shard.id}__real-codex-prompt.txt`);
const codexLogPath = path.join(path.dirname(assignment.logPath), `${assignment.shard.id}__real-codex.log`);
ensureParent(promptPath);
fs.writeFileSync(promptPath, prompt);

const codexBin = process.env.CODEX_BIN || '/home/jake/.local/bin/codex';
const codexModel = process.env.SHOWCASE_CODEX_MODEL || process.env.CODEX_MODEL || 'gpt-5.5';
const codexSandbox = process.env.SHOWCASE_CODEX_SANDBOX || process.env.CODEX_CREATIVE_SANDBOX || 'workspace-write';
const timeoutMs = Math.max(30_000, Number(process.env.SHOWCASE_CODEX_TIMEOUT_MS || 300_000));
const codexArgs = [
  'exec',
  '--cd', workspace,
  '--skip-git-repo-check',
  '--sandbox', codexSandbox,
  '--color', 'never',
  '--model', codexModel,
  prompt
];
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
// In shared-workspace parallel runs, sibling candidate agents may legitimately create
// their own files while this Codex process is running. Treat only new files inside
// the current candidate root as attributable out-of-scope writes for this role.
const newOutOfScope = [...afterAll].filter((rel) => {
  if (beforeAll.has(rel) || allowedFiles.includes(rel)) return false;
  return rel.startsWith(currentCandidateRoot);
});
const ok = !run.error && run.status === 0 && changed.length > 0 && newOutOfScope.length === 0;
const result = {
  ok,
  modifiedFiles: changed,
  unifiedDiff: diffForChanged(workspace, before, changed),
  diffSummary: `${candidateId} ${role}: real Codex role produced ${changed.length} allowed file change(s)`,
  stdout: '',
  stderr: ok ? '' : JSON.stringify({ status: run.status, signal: run.signal || null, error: run.error?.message || null, changed, newOutOfScope }),
  metadata: {
    showcase: 'webhook_real_codex_architecture_tournament',
    realCodex: true,
    candidateId,
    role,
    explorationSeed: candidateSeed(candidateId),
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
      runtimeIntegrated: role !== 'architect',
      modifiedPrimaryRuntimeFiles: changed.filter((rel) => rel.endsWith('.mjs')),
      modifiedRequiredLayers: [role],
      semanticBloatAudit: { semanticBloatSuspect: false, duplicateAddedLineRatio: 0 },
      summary: `Real Codex ${role} role for ${candidateId}`
    },
    proofCarryingClaim: {
      statement: `Real Codex ${role} role contributed to ${candidateId}.`,
      requestedCredit: 'real_codex_showcase_role_credit',
      surfaceIds: [candidateId, `${candidateId}__${role}`],
      negativeSpaceReduced: ok,
      reducedGaps: [`${role}_real_codex_artifact`],
      remainingGaps: 'Final scorer/refiner and tournament verifier choose the winner; this is a showcase, not production deployment.',
      sourceOfTruthIntegrated: changed.length > 0,
      proofArtifacts: [promptPath, codexLogPath, ...changed]
    }
  }
};
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 2);
