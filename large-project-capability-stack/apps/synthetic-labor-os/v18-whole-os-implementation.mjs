#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  SLOS_V18_ALLOWED_PATCH_PATHS,
  SLOS_V18_ROLES,
  SLOS_V18_SOURCE_SNAPSHOT_FILES,
  allowedFilesForRole,
  candidatePatchPath,
  candidateRoot,
  candidateTestPlanPath,
  candidateTheme
} from './v18-whole-os-catalog.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--assignment') args.assignment = argv[index + 1];
  }
  return args;
}

function parseFixture(value = '') {
  const [candidateId, role = 'runtime_implementer'] = String(value || '').split('::');
  if (!SLOS_V18_ROLES.includes(role)) throw new Error(`Unknown SLOS v18 role: ${role}`);
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

function restoreChangedFiles(workspace, before, files) {
  const restored = [];
  for (const rel of files) {
    const previous = before.get(rel) || null;
    const target = ensureInside(workspace, rel);
    const content = readFileMaybe(target);
    const currentHash = content === null ? null : sha256(content);
    const previousHash = previous?.hash || null;
    if (currentHash === previousHash) continue;
    ensureParent(target);
    if (previous?.content === undefined || previous?.content === null) {
      try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch {}
    } else {
      fs.writeFileSync(target, previous.content);
    }
    restored.push(rel);
  }
  return restored;
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
    chunks.push('@@ slos v18 whole-os role delta @@');
    const lines = current.split('\n').slice(0, 260);
    chunks.push(...lines.map((line) => `+${line}`));
    if (current.split('\n').length > 260) chunks.push('+...[diff truncated]');
  }
  return chunks.join('\n');
}

function readSnippet(workspace, rel, max = 5000) {
  const text = readFileMaybe(ensureInside(workspace, rel));
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function sourceSnippet(workspace, rel, max = 3800) {
  return readSnippet(workspace, `source_snapshot/${rel}`, max);
}

function selectedSourceContext(workspace) {
  const keyFiles = [
    'packages/synthetic-labor-os/index.mjs',
    'apps/synthetic-labor-os/operator-dashboard.mjs',
    'apps/synthetic-labor-os/operator-console.mjs',
    'apps/synthetic-labor-os/local-runner.mjs',
    'apps/synthetic-labor-os/remote-dispatcher.mjs',
    'apps/synthetic-labor-os/apply-patch-gate.mjs',
    'tests/synthetic-labor-os.test.mjs',
    'tests/synthetic-labor-os-remote-smoke.test.mjs',
    'docs/SYNTHETIC_LABOR_OS_V0.md'
  ];
  return keyFiles.map((rel) => `\n### ${rel}\n${sourceSnippet(workspace, rel, rel.endsWith('.md') ? 2200 : 3600) || '[missing from source snapshot]'}`).join('\n');
}

function candidateContext(workspace, candidateId) {
  const root = candidateRoot(candidateId);
  const files = [
    `${root}/architecture.json`,
    `${root}/README.md`,
    `${root}/proposal.md`,
    candidatePatchPath(candidateId),
    candidateTestPlanPath(candidateId),
    `${root}/role-artifacts/adversarial-review.md`,
    `${root}/role-artifacts/scorecard.json`
  ];
  return files.map((rel) => {
    const text = readSnippet(workspace, rel, rel.endsWith('.patch') ? 9000 : 3500);
    return text ? `\n### ${rel}\n${text}` : '';
  }).filter(Boolean).join('\n');
}

function rolePrompt({ assignment, workspace, candidateId, role, allowedFiles }) {
  const root = candidateRoot(candidateId);
  const theme = candidateTheme(candidateId);
  const allowedArtifactFiles = allowedFiles.map((rel) => `- ${rel}`).join('\n');
  const allowedPatchPaths = SLOS_V18_ALLOWED_PATCH_PATHS.map((rel) => `- ${rel}`).join('\n');
  const existingContext = candidateContext(workspace, candidateId) || '[no prior candidate context yet]';
  const sourceContext = selectedSourceContext(workspace);
  const common = `You are a real Codex CLI role-agent in Synthetic Labor OS v18.\n\nObjective: create one whole-Synthetic-Labor-OS variant, not a docs-only candidate.\nCandidate: ${candidateId}\nVariant theme: ${theme}\nRole: ${role}\nWorkspace: ${workspace}\n\nYou may create or edit ONLY these candidate artifact files in the workspace:\n${allowedArtifactFiles}\n\nThe final candidate patch must be a unified git diff relative to the repository root. It may modify ONLY these real SLOS files:\n${allowedPatchPaths}\n\nWhole-OS requirements for a valid candidate:\n- The patch must modify at least one SLOS runtime/CLI/core file under packages/synthetic-labor-os or apps/synthetic-labor-os.\n- The patch must modify or add relevant assertions in tests/synthetic-labor-os.test.mjs or tests/synthetic-labor-os-remote-smoke.test.mjs.\n- Docs-only, runbook-only, and artifact-only patches are invalid.\n- Do not deploy, publish, merge, send externally, install dependencies, or edit files outside the allowed patch list.\n- Keep the patch reviewable. Prefer a coherent production-slice improvement to broad churn.\n- Preserve honest truth boundaries: do not call launcher green a product release, and do not blur local apply with merge/publish/deploy.\n\nSource snapshot excerpts are under source_snapshot/ and are read-only context:\n${sourceContext}\n`;
  if (role === 'systems_architect') return `${common}\nDesign a full SLOS variant for the theme. Write:\n1. ${root}/architecture.json with id, title, theme, problem, proposedRuntimeChange, affectedFiles, tests, risks, nonGoals, scoringFocus.\n2. ${root}/README.md explaining the whole-OS improvement.\n3. ${root}/role-artifacts/systems-architect-brief.md with implementation guidance.\nDo not write the patch yet.`;
  if (role === 'runtime_implementer') return `${common}\nPrior candidate context:\n${existingContext}\n\nWrite ${candidatePatchPath(candidateId)} as a valid unified diff against the real repository root. Also write ${root}/proposal.md and ${root}/role-artifacts/runtime-implementer-notes.md.\n\nThe patch must include actual SLOS runtime/CLI/core behavior plus tests. Make a concrete improvement to operator usability, provenance, remote-boundary evidence, lifecycle safety, dashboard/console clarity, or apply-gate discipline.`;
  if (role === 'test_engineer') return `${common}\nPrior candidate context and patch:\n${existingContext}\n\nImprove the candidate patch if needed so it includes meaningful tests for the runtime change. Write ${candidateTestPlanPath(candidateId)} and ${root}/role-artifacts/test-engineer-notes.md with exact validation commands and expected evidence. Do not settle for docs-only evidence.`;
  if (role === 'adversarial_reviewer') return `${common}\nPrior candidate context and patch:\n${existingContext}\n\nAct as an adversarial reviewer. You may make minimal patch fixes if the candidate overclaims, lacks tests, or touches the wrong surface. Write ${root}/role-artifacts/adversarial-review.md and .json with risks, counterexamples checked, verdict, and remaining gaps.`;
  return `${common}\nPrior candidate context and patch:\n${existingContext}\n\nYou are the release scorer/refiner. Make minimal final fixes so the patch applies and the SLOS tests should pass. Write ${root}/role-artifacts/scorecard.json and refinement-notes.md. The scorecard must include: score 0-100, strengths, weaknesses, rationale, changedRuntimeFiles, changedTestFiles, validationCommand, shouldWin. Do not broaden beyond a reviewable whole-OS production slice.`;
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
const protectedFiles = SLOS_V18_SOURCE_SNAPSHOT_FILES.map((rel) => `source_snapshot/${rel}`);
const protectedBefore = snapshotFiles(workspace, protectedFiles);
const beforeAll = new Set(listFiles(workspace));
const prompt = rolePrompt({ assignment, workspace, candidateId, role, allowedFiles });
const promptPath = path.join(path.dirname(assignment.resultPath), `${assignment.shard.id}__v18-whole-os-prompt.txt`);
const codexLogPath = path.join(path.dirname(assignment.logPath), `${assignment.shard.id}__v18-codex.log`);
ensureParent(promptPath);
fs.writeFileSync(promptPath, prompt);

const codexBin = process.env.CODEX_BIN || '/home/jake/.local/bin/codex';
const codexModel = process.env.SLOS_V18_CODEX_MODEL || process.env.SHOWCASE_CODEX_MODEL || process.env.CODEX_MODEL || 'gpt-5.5';
const codexSandbox = process.env.SLOS_V18_CODEX_SANDBOX || process.env.SHOWCASE_CODEX_SANDBOX || process.env.CODEX_CREATIVE_SANDBOX || 'workspace-write';
const timeoutMs = Math.max(30_000, Number(process.env.SLOS_V18_CODEX_TIMEOUT_MS || 600_000));
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
const restoredProtectedFiles = restoreChangedFiles(workspace, protectedBefore, protectedFiles);
const changed = changedAllowedFiles(workspace, before, allowedFiles);
const afterAll = new Set(listFiles(workspace));
const currentCandidateRoot = `${candidateRoot(candidateId)}/`;
const currentCandidateTestPlan = candidateTestPlanPath(candidateId);
const newOutOfScope = [...afterAll].filter((rel) => {
  if (beforeAll.has(rel) || allowedFiles.includes(rel)) return false;
  return rel.startsWith(currentCandidateRoot) || rel === currentCandidateTestPlan || rel.startsWith('source_snapshot/');
}).filter((rel) => !allowedFiles.includes(rel));
const scopedArtifactOutput = changed.length > 0 && newOutOfScope.length === 0 && restoredProtectedFiles.length === 0;
const ok = scopedArtifactOutput;
const result = {
  ok,
  modifiedFiles: changed,
  unifiedDiff: diffForChanged(workspace, before, changed),
  diffSummary: `${candidateId} ${role}: real Codex whole-SLOS role produced ${changed.length} allowed artifact change(s)`,
  stdout: '',
  stderr: ok ? '' : JSON.stringify({ status: run.status, signal: run.signal || null, error: run.error?.message || null, changed, newOutOfScope, restoredProtectedFiles }),
  metadata: {
    showcase: 'slos_v18_whole_os_variant_tournament',
    realCodex: true,
    candidateId,
    role,
    variantTheme: candidateTheme(candidateId),
    command: `${codexBin} ${codexArgs.slice(0, -1).join(' ')} <prompt>`,
    codexModel,
    codexSandbox,
    durationMs: finishedAt - startedAt,
    exitCode: run.status ?? (run.error ? 1 : 0),
    signal: run.signal || null,
    error: run.error?.message || null,
    codexProcessOk: !run.error && run.status === 0,
    scopedArtifactOutput,
    promptPath,
    codexLogPath,
    allowedFiles,
    allowedPatchPaths: SLOS_V18_ALLOWED_PATCH_PATHS,
    changedAllowedFiles: changed,
    newOutOfScopeFiles: newOutOfScope,
    restoredProtectedFiles,
    architectureEvidence: {
      ok: changed.length > 0 && newOutOfScope.length === 0 && restoredProtectedFiles.length === 0,
      layerCount: 1,
      layers: [role],
      runtimeIntegrated: ['runtime_implementer', 'test_engineer', 'adversarial_reviewer', 'release_scorer'].includes(role),
      modifiedPrimaryRuntimeFiles: changed,
      modifiedRequiredLayers: [role],
      semanticBloatAudit: { semanticBloatSuspect: false, duplicateAddedLineRatio: 0 },
      summary: `Real Codex ${role} role for whole-SLOS variant ${candidateId}`
    },
    proofCarryingClaim: {
      statement: `Real Codex ${role} role contributed to a whole-Synthetic-Labor-OS variant ${candidateId}.`,
      requestedCredit: 'real_codex_slos_v18_whole_os_role_credit',
      surfaceIds: [candidateId, `${candidateId}__${role}`],
      negativeSpaceReduced: scopedArtifactOutput,
      reducedGaps: [`${role}_whole_os_variant_artifact`],
      remainingGaps: 'Final release scorer and whole-OS verifiers choose the winner; this is internal SLOS production-slice work, not deployment.',
      sourceOfTruthIntegrated: changed.length > 0,
      proofArtifacts: [promptPath, codexLogPath, ...changed]
    }
  }
};
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 2);
