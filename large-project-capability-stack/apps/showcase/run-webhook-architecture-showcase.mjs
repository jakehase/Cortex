#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import { WEBHOOK_SHOWCASE_VARIANTS, allowedFilesForVariant, productRootForVariant, scoreArchitecture } from './webhook-architecture-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').slice(0, 15) + 'Z';
}

function parseArgs(argv) {
  const args = {
    artifactRoot: path.join(STACK_ROOT, 'artifacts', 'showcases', `webhook-architecture-tournament-${timestamp()}`),
    agentCount: 20,
    maxRuntimeMs: 180_000,
    workerTimeoutMs: 45_000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--agent-count') { args.agentCount = Number(next); index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--worker-timeout-ms') { args.workerTimeoutMs = Number(next); index += 1; continue; }
  }
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function stableList(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).flat().filter(Boolean).map(String))].sort();
}

function buildWorkGraph(workspacePath) {
  return {
    schemaVersion: 'clawd.webhook_architecture_showcase_work_graph.v1',
    generatedAt: new Date().toISOString(),
    targetPath: workspacePath,
    workUnits: WEBHOOK_SHOWCASE_VARIANTS.map((variant) => ({
      id: variant.id,
      title: variant.title,
      goal: `Create and test a ${variant.title} copy of the webhook event inbox + replay slice.`,
      lane: 'architecture_candidate',
      domain: variant.pattern,
      fileAreas: allowedFilesForVariant(variant),
      allowedFiles: allowedFilesForVariant(variant),
      acceptanceChecks: [
        `node --test tests/webhook-showcase/${variant.id}.test.mjs`,
        'static architecture verifier passes'
      ],
      requiredVerifiers: ['tests', 'lint'],
      metadata: {
        fixtureModuleId: variant.id,
        architectureId: variant.id,
        architectureTitle: variant.title,
        architecturePattern: variant.pattern,
        routeNamespaces: ['/webhooks/events', '/events', '/events/:id/replay'],
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: allowedFilesForVariant(variant).filter((rel) => rel.startsWith('apps/')),
          targetModules: [productRootForVariant(variant)],
          verifierRequirements: ['tests', 'lint'],
          successPredicate: [
            'receive/idempotency/process/fail/replay/query behavior passes',
            'architecture verifier finds explicit layers and no marker-only code'
          ]
        }
      }
    }))
  };
}

function buildSurfaceMatrix() {
  return {
    schemaVersion: 'clawd.webhook_architecture_showcase_surface_matrix.v1',
    generatedAt: new Date().toISOString(),
    surfaces: WEBHOOK_SHOWCASE_VARIANTS.map((variant) => ({
      id: variant.id,
      label: variant.title,
      status: 'pending',
      productFiles: allowedFilesForVariant(variant).filter((rel) => rel.startsWith('apps/')),
      requiredArtifacts: [
        { kind: 'verifier_command', command: `node --test tests/webhook-showcase/${variant.id}.test.mjs` },
        { kind: 'verifier_command', command: 'static architecture verifier' }
      ],
      metadata: { pattern: variant.pattern, layers: variant.layers }
    }))
  };
}

function writeAgentWorkSpec(root, workspacePath) {
  const lines = [
    'goal WebhookArchitectureTournament',
    'outcome Produce 20 reviewable webhook event inbox + replay architecture candidates, test each one, and select the strongest architecture.',
    `repo ${workspacePath}`,
    'fidelity production_slice',
    'agents 20',
    'forbid external_send, touch_prod',
    'done all_surfaces_pass, no_truth_layer_overclaim, architecture_winner_selected',
    '',
    'budget',
    '  worker_prompt_tokens: 3200',
    '  global_calls: 20',
    '',
    'evidence_schema showcase_quality',
    '  require: verified_surface_count >= 20',
    '  require: architectureWinnerSelected == 1',
    '  artifact: architecture_scores.json',
    '',
    ...WEBHOOK_SHOWCASE_VARIANTS.flatMap((variant) => [
      `surface ${variant.id}`,
      `  label: ${variant.title}`,
      `  goal: Implement the webhook inbox/replay slice using ${variant.pattern}.`,
      `  lane: architecture_candidate`,
      `  domain: ${variant.pattern}`,
      `  files: ${allowedFilesForVariant(variant).join(', ')}`,
      `  verify: node --test tests/webhook-showcase/${variant.id}.test.mjs, static architecture verifier`,
      ''
    ])
  ];
  fs.writeFileSync(path.join(root, 'agent_work_spec.aw'), `${lines.join('\n')}\n`);
}

function collectCandidateScores({ root, liveRun }) {
  const resultDir = path.join(root, 'orchestrator_run', 'results');
  const results = fs.existsSync(resultDir)
    ? fs.readdirSync(resultDir).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(resultDir, name), null)).filter(Boolean)
    : [];
  const mergedIds = new Set((liveRun.patchQueue?.merged || []).map((patch) => patch.shardId));
  const rejected = new Map((liveRun.patchQueue?.rejected || []).map((patch) => [patch.shardId, patch]));
  const rows = WEBHOOK_SHOWCASE_VARIANTS.map((variant) => {
    const result = results.find((entry) => entry.shardId === variant.id) || null;
    const verifierResults = result?.verifierResults || [];
    const tests = verifierResults.find((entry) => entry.verifier === 'tests') || null;
    const lint = verifierResults.find((entry) => entry.verifier === 'lint') || null;
    const parsedLintStdout = (() => {
      try { return lint?.stdout ? JSON.parse(lint.stdout) : null; }
      catch { return null; }
    })();
    const metrics = lint?.metadata || parsedLintStdout?.metadata || {};
    const score = scoreArchitecture({
      variant,
      testOk: tests?.ok === true,
      lintOk: lint?.ok === true,
      metrics
    });
    return {
      id: variant.id,
      title: variant.title,
      pattern: variant.pattern,
      layers: variant.layers,
      status: mergedIds.has(variant.id) ? 'merged' : rejected.has(variant.id) ? 'rejected' : result?.ok === true ? 'verified_unmerged' : 'missing_or_failed',
      testsOk: tests?.ok === true,
      architectureOk: lint?.ok === true,
      score: score.total,
      rawScore: score.rawTotal,
      scoreBreakdown: score.breakdown,
      scoreRubric: score.rubric,
      lineCount: metrics.lineCount || null,
      fileCount: metrics.fileCount || null,
      productRoot: productRootForVariant(variant),
      testPath: `tests/webhook-showcase/${variant.id}.test.mjs`,
      note: variant.note,
      rejectionReason: rejected.get(variant.id)?.rejectionReason || null,
      resultPath: result?.implementation?.metadata ? result?.resultPath || null : null
    };
  }).sort((a, b) => b.score - a.score || (b.rawScore || 0) - (a.rawScore || 0) || a.id.localeCompare(b.id));
  const winner = rows.find((row) => row.testsOk && row.architectureOk && row.status === 'merged') || rows[0] || null;
  return { rows, winner };
}

function renderReviewPack({ root, summary, scores }) {
  const winner = scores.winner;
  const top = scores.rows.slice(0, 5);
  const lines = [
    '# Webhook Event Inbox + Replay Architecture Tournament',
    '',
    '## What this proves',
    '',
    '- 20 architecture candidates were launched as isolated orchestration shards.',
    '- Each candidate materialized a full small app copy plus tests.',
    '- Each candidate ran behavior tests and a static architecture verifier.',
    '- The winner was selected by an explicit rubric rather than vibe.',
    '',
    '## Run truth',
    '',
    `- Mechanical green: ${summary.mechanicalGreen}`,
    `- Merged candidates: ${summary.mergedShardCount}/${summary.shardCount}`,
    `- Peak concurrent workers: ${summary.metrics?.peakConcurrentWorkers ?? 'n/a'}`,
    `- Worker spawn count: ${summary.metrics?.workerSpawnCount ?? 'n/a'}`,
    '',
    '## Winner',
    '',
    winner ? `**${winner.title}** (\`${winner.id}\`) — score ${winner.score}` : 'No winner selected.',
    winner ? `- Pattern: ${winner.pattern}` : '',
    winner ? `- Product root: \`${winner.productRoot}\`` : '',
    winner ? `- Why: ${winner.note}` : '',
    winner ? `- Score breakdown: \`${JSON.stringify(winner.scoreBreakdown)}\`` : '',
    '',
    '## Top 5',
    '',
    ...top.map((row, index) => `${index + 1}. **${row.title}** — ${row.score} (${row.status}, files=${row.fileCount}, lines=${row.lineCount})`),
    '',
    '## Review instructions',
    '',
    winner ? `Start with \`${path.join(root, 'workspace', winner.productRoot)}\` and \`${path.join(root, 'workspace', winner.testPath)}\`.` : '',
    'Then inspect:',
    '- `agent_work_spec.aw` — the human-readable contract',
    '- `work_graph.json` and `surface_matrix.json` — what the orchestrator executed',
    '- `orchestrator_run/worker_events.json` — launch/concurrency truth',
    '- `orchestrator_run/patch_queue.json` — admitted/rejected patches',
    '- `architecture_scores.json` — scoring details',
    '',
    '## Truth boundary',
    '',
    'This is a deterministic architecture tournament to showcase orchestration, review artifacts, and gates. It does not claim 20 model agents independently invented these designs unless rerun with real model workers.'
  ].filter((line) => line !== '').join('\n');
  fs.writeFileSync(path.join(root, 'review_pack.md'), `${lines}\n`);
}

const args = parseArgs(process.argv.slice(2));
const artifactRoot = path.resolve(args.artifactRoot);
const workspacePath = path.join(artifactRoot, 'workspace');
fs.mkdirSync(workspacePath, { recursive: true });
fs.mkdirSync(path.join(workspacePath, 'apps'), { recursive: true });
fs.mkdirSync(path.join(workspacePath, 'tests'), { recursive: true });

const workGraph = buildWorkGraph(workspacePath);
const surfaceMatrix = buildSurfaceMatrix();
writeJson(path.join(artifactRoot, 'work_graph.json'), workGraph);
writeJson(path.join(artifactRoot, 'surface_matrix.json'), surfaceMatrix);
writeAgentWorkSpec(artifactRoot, workspacePath);

const liveRun = await runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount: Math.max(1, Number(args.agentCount || 20)),
  workerScriptPath: path.join(STACK_ROOT, 'apps/orchestrator-qualification/live-worker.mjs'),
  verifierScriptPath: path.join(SCRIPT_DIR, 'webhook-showcase-verifier.mjs'),
  implementationScriptPath: path.join(SCRIPT_DIR, 'webhook-showcase-implementation.mjs'),
  workspacePath,
  runRoot: path.join(artifactRoot, 'orchestrator_run'),
  maxRuntimeMs: Math.max(30_000, Number(args.maxRuntimeMs || 180_000)),
  workerTimeoutMs: Math.max(10_000, Number(args.workerTimeoutMs || 45_000)),
  leaseTtlMs: 30_000,
  maxAttemptsPerTask: 1,
  maxSpawnsPerTick: Math.max(1, Number(args.agentCount || 20)),
  plannerOptions: {
    maxFileAreasPerShard: 100,
    maxFilesPerShard: 100,
    maxAcceptanceChecksPerShard: 10
  },
  executionMode: 'webhook_architecture_showcase_tournament',
  campaignContract: {
    fidelity: 'production_slice',
    requestedScope: WEBHOOK_SHOWCASE_VARIANTS.map((variant) => variant.id),
    repoPath: workspacePath,
    targetPath: workspacePath
  },
  contextGovernorOptions: { enabled: true, hardGate: false, maxWorkerTokens: 3200, workerPromptMode: 'compact' }
});

const scores = collectCandidateScores({ root: artifactRoot, liveRun });
const summary = {
  schemaVersion: 'clawd.webhook_architecture_showcase_summary.v1',
  generatedAt: new Date().toISOString(),
  artifactRoot,
  workspacePath,
  agentCount: Math.max(1, Number(args.agentCount || 20)),
  shardCount: liveRun.shardCount || WEBHOOK_SHOWCASE_VARIANTS.length,
  mergedShardCount: liveRun.mergedShardCount || liveRun.patchQueue?.merged?.length || 0,
  rejectedPatchCount: liveRun.patchQueue?.rejected?.length || 0,
  mechanicalGreen: (liveRun.patchQueue?.merged?.length || 0) === WEBHOOK_SHOWCASE_VARIANTS.length,
  thresholdPass: false,
  thresholdPassReason: 'showcase_tournament_has_no_benchmark_threshold; use architectureWinnerSelected and mechanicalGreen instead',
  architectureWinnerSelected: scores.winner ? 1 : 0,
  winner: scores.winner,
  metrics: liveRun.metrics,
  truthBoundary: 'Deterministic architecture tournament for orchestration showcase; not a real-model creativity claim.'
};
writeJson(path.join(artifactRoot, 'architecture_scores.json'), scores);
writeJson(path.join(artifactRoot, 'completion_summary.json'), summary);
renderReviewPack({ root: artifactRoot, summary, scores });

console.log(JSON.stringify({ ok: summary.mechanicalGreen && Boolean(scores.winner), artifactRoot, winner: scores.winner, mergedShardCount: summary.mergedShardCount, shardCount: summary.shardCount }, null, 2));
process.exit(summary.mechanicalGreen && scores.winner ? 0 : 1);
