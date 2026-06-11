import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function countFiles(root, predicate) {
  return walk(root).filter(predicate).length;
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function termCount(text, term) {
  const m = text.match(new RegExp(term, 'ig'));
  return m ? m.length : 0;
}

export function profileClawhip({ repoRoot }) {
  const readme = safeRead(path.join(repoRoot, 'README.md'));
  const files = walk(repoRoot).filter((p) => !p.includes(`${path.sep}.git${path.sep}`) && !p.includes(`${path.sep}target${path.sep}`));
  const textBlob = files
    .filter((p) => /\.(rs|md|toml|ya?ml)$/i.test(p))
    .slice(0, 400)
    .map((p) => safeRead(p).slice(0, 10000))
    .join('\n');
  const evidence = {
    eventContract: exists(repoRoot, 'docs/event-contract-v1.md'),
    router: exists(repoRoot, 'src/router.rs'),
    monitor: exists(repoRoot, 'src/monitor.rs'),
    plugins: exists(repoRoot, 'src/plugins.rs'),
    tmux: exists(repoRoot, 'src/tmux_wrapper.rs'),
    slack: exists(repoRoot, 'src/slack.rs'),
    cargo: exists(repoRoot, 'Cargo.toml')
  };
  return {
    id: 'clawhip',
    repoRoot,
    evidence,
    metrics: {
      fileCount: files.length,
      rustFiles: files.filter((p) => p.endsWith('.rs')).length,
      docsFiles: files.filter((p) => p.endsWith('.md')).length,
      taskCoordinationSignals: {
        discord: termCount(textBlob + readme, 'discord'),
        slack: termCount(textBlob + readme, 'slack'),
        tmux: termCount(textBlob + readme, 'tmux'),
        router: termCount(textBlob + readme, 'router'),
        monitor: termCount(textBlob + readme, 'monitor'),
        session: termCount(textBlob + readme, 'session'),
        eventContract: termCount(textBlob + readme, 'event-contract|event contract'),
        plugin: termCount(textBlob + readme, 'plugin')
      }
    },
    derived: {
      operatorSurfaceStrength: evidence.slack || evidence.tmux || evidence.router,
      coordinationRuntimeStrength: evidence.router && evidence.monitor && evidence.plugins,
      eventContractStrength: evidence.eventContract,
      likelyAutonomyOrientation: evidence.router && evidence.monitor && evidence.tmux
    }
  };
}

export function profileCortex({ stackRoot, mailchimpRoot }) {
  const stackFiles = walk(stackRoot);
  const mailFiles = walk(mailchimpRoot);
  const evidence = {
    taskContract: exists(stackRoot, 'packages/task-contract/index.mjs'),
    issueDag: exists(stackRoot, 'packages/issue-dag/index.mjs'),
    campaignRuntime: exists(stackRoot, 'packages/campaign-runtime/index.mjs'),
    architectureEnforcer: exists(stackRoot, 'packages/architecture-enforcer/index.mjs'),
    surfaceMatrix: exists(stackRoot, 'packages/surface-matrix/index.mjs'),
    recoveryLedger: exists(stackRoot, 'packages/recovery-ledger/index.mjs'),
    multiAgentOrchestrator: exists(stackRoot, 'packages/multi-agent-orchestrator/index.mjs'),
    truthGating: exists(stackRoot, 'packages/certification/index.mjs'),
    codeValueAudit: exists(stackRoot, 'packages/code-value-audit/index.mjs'),
    realRepo100Qualification: exists(mailchimpRoot, 'artifacts/qualification/orchestrator_real_repo/completion_summary.json')
  };
  const orchestrationSummary = safeRead(path.join(mailchimpRoot, 'artifacts/qualification/orchestrator_real_repo/completion_summary.json'));
  return {
    id: 'cortex',
    stackRoot,
    mailchimpRoot,
    evidence,
    metrics: {
      stackFileCount: stackFiles.length,
      mailchimpFileCount: mailFiles.length,
      qualificationSignals: {
        proven100Live: /provenCoordinationScaleTier"?\s*:\s*100/.test(orchestrationSummary),
        supervisorConfirmed: /supervisorConfirmedCompletion"?\s*:\s*true/.test(orchestrationSummary)
      }
    },
    derived: {
      truthDisciplineStrength: evidence.truthGating && evidence.codeValueAudit,
      orchestrationRuntimeStrength: evidence.multiAgentOrchestrator && evidence.realRepo100Qualification,
      planningDepthStrength: evidence.taskContract && evidence.issueDag && evidence.surfaceMatrix,
      likelyAutonomyOrientation: evidence.campaignRuntime && evidence.multiAgentOrchestrator
    }
  };
}

export function compareSystems({ cortex, clawhip }) {
  const categories = {
    autonomy_delivery: {
      cortex: cortex.derived.orchestrationRuntimeStrength ? 8 : 5,
      clawhip: clawhip.derived.likelyAutonomyOrientation ? 9 : 6,
      winner: (clawhip.derived.likelyAutonomyOrientation ? 9 : 6) > (cortex.derived.orchestrationRuntimeStrength ? 8 : 5) ? 'clawhip' : 'cortex',
      note: 'Clawhip appears more explicitly shaped around hands-off messaging-driven delivery; Cortex now has stronger proven orchestration artifacts but still carries more governance overhead.'
    },
    truthfulness_and_claim_control: {
      cortex: cortex.derived.truthDisciplineStrength ? 10 : 6,
      clawhip: clawhip.derived.eventContractStrength ? 6 : 4,
      winner: 'cortex',
      note: 'Cortex has explicit claim ladders, truth gates, blocker semantics, and code-value auditing. Clawhip exposes coordination signals but not the same visible overclaim-prevention machinery in this repo-level inspection.'
    },
    coordination_runtime: {
      cortex: cortex.derived.orchestrationRuntimeStrength ? 9 : 5,
      clawhip: clawhip.derived.coordinationRuntimeStrength ? 8 : 5,
      winner: cortex.derived.orchestrationRuntimeStrength ? 'cortex' : 'clawhip',
      note: 'Both appear coordination-oriented; Cortex has artifact-backed 100-agent qualification in this workspace, while clawhip shows router/monitor/plugins/tmux structure that strongly suggests an operational coordination runtime.'
    },
    operator_experience: {
      cortex: 6,
      clawhip: clawhip.derived.operatorSurfaceStrength ? 9 : 6,
      winner: clawhip.derived.operatorSurfaceStrength ? 'clawhip' : 'tie',
      note: 'Clawhip appears more directly optimized around chat/terminal ops surfaces; Cortex currently feels heavier and more governance-forward.'
    },
    auditability_and_recovery: {
      cortex: 10,
      clawhip: clawhip.derived.eventContractStrength ? 7 : 5,
      winner: 'cortex',
      note: 'Cortex externalizes more project state into contracts, matrices, reports, and recovery artifacts.'
    }
  };
  return {
    schemaVersion: 'claw.system-benchmark.v1',
    generatedAt: new Date().toISOString(),
    benchmarkType: 'repo_and_capability_profile_plus_execution_readiness',
    limitation: 'This is not a head-to-head live coding benchmark of both systems on the same tasks. It is a concrete repo/capability comparison plus a benchmark plan scaffold.',
    cortex,
    clawhip,
    categories,
    overall: {
      betterForAutonomousCodingToday: 'clawhip',
      betterForTruthAndClaimControl: 'cortex',
      recommendedNextStep: 'Run a real head-to-head benchmark on the same repo/tasks/time-budget if you want a definitive winner.'
    }
  };
}

export function renderComparisonReport(result) {
  const lines = [
    '# Cortex vs clawhip Comparison',
    '',
    `- Generated at: ${result.generatedAt}`,
    `- Benchmark type: ${result.benchmarkType}`,
    `- Limitation: ${result.limitation}`,
    '',
    '## Repo/capability snapshot',
    `- Cortex orchestration runtime strength: ${result.cortex.derived.orchestrationRuntimeStrength}`,
    `- Cortex truth-discipline strength: ${result.cortex.derived.truthDisciplineStrength}`,
    `- clawhip coordination runtime strength: ${result.clawhip.derived.coordinationRuntimeStrength}`,
    `- clawhip operator surface strength: ${result.clawhip.derived.operatorSurfaceStrength}`,
    '',
    '## Category winners'
  ];
  for (const [name, row] of Object.entries(result.categories)) {
    lines.push(`- ${name}: ${row.winner} (Cortex ${row.cortex} / clawhip ${row.clawhip})`);
    lines.push(`  - ${row.note}`);
  }
  lines.push('', '## Overall', `- Better for autonomous coding today: ${result.overall.betterForAutonomousCodingToday}`, `- Better for truth and claim control: ${result.overall.betterForTruthAndClaimControl}`, `- Recommended next step: ${result.overall.recommendedNextStep}`);
  return `${lines.join('\n')}\n`;
}

function ensureDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function writeJson(targetPath, value) {
  ensureDir(targetPath);
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(targetPath, fallback = null) {
  if (!fs.existsSync(targetPath)) return fallback;
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'benchmark';
}

function stampNow() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function createBenchmarkRunContract({
  benchmarkId,
  benchmarkTier,
  benchmarkClass = 'brownfield_product_transfer',
  fidelity = 'production_slice',
  scope = {},
  repoPath,
  verifierSet = [],
  requestedAgentCount = 10,
  executionBoundary = 'local_or_remote',
  stopCondition = 'supervisor_green_or_blocker_report',
  scoreboardPath = 'artifacts/benchmarks/scoreboard.json',
  runId,
  artifactRoot,
  notes = '',
  replyAnchor = ''
}) {
  const finalBenchmarkId = slugify(benchmarkId || path.basename(repoPath || 'benchmark'));
  const finalRunId = runId || `${finalBenchmarkId}-${stampNow()}-${crypto.randomBytes(2).toString('hex')}`;
  const finalArtifactRoot = artifactRoot || path.join('artifacts', 'benchmarks', finalBenchmarkId, finalRunId);
  return {
    schemaVersion: 'claw.agent_benchmark_run_contract.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: finalBenchmarkId,
    benchmarkTier: benchmarkTier || 'tier1_smoke',
    benchmarkClass,
    fidelity,
    scope,
    repoPath: repoPath ? path.resolve(repoPath) : '',
    verifierSet,
    requestedAgentCount,
    executionBoundary,
    stopCondition,
    scoreboardPath,
    runId: finalRunId,
    artifactRoot: finalArtifactRoot,
    notes,
    replyAnchor
  };
}

export function benchmarkRunContractTemplate() {
  return createBenchmarkRunContract({
    benchmarkId: 'replace_me_benchmark',
    benchmarkTier: 'tier1_smoke',
    benchmarkClass: 'brownfield_product_transfer',
    fidelity: 'production_slice',
    scope: {
      surfaces: [
        {
          id: 'replace_me_surface',
          label: 'Replace me surface',
          allowedFiles: ['src/replace-me.mjs'],
          verification: ['node --test tests/replace-me.test.mjs']
        }
      ],
      durationTargetMinutes: 60,
      stopCondition: 'supervisor_green_or_blocker_report'
    },
    repoPath: '/absolute/path/to/repo',
    verifierSet: [
      {
        kind: 'node_script',
        command: 'node --test tests/replace-me.test.mjs'
      }
    ],
    requestedAgentCount: 10,
    executionBoundary: 'remote_execution_required',
    scoreboardPath: 'artifacts/benchmarks/scoreboard.json',
    runId: 'replace-me-run-id',
    artifactRoot: 'artifacts/benchmarks/replace_me_benchmark/replace-me-run-id',
    notes: 'Fill in benchmark-specific scope, verifier, and execution details.',
    replyAnchor: 'Replace with the user request or benchmark charter.'
  });
}

export function resolveBenchmarkDurationTargetMinutes(scope = {}) {
  const raw = Number(scope?.durationTargetMinutes);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Number(raw.toFixed(2));
}

export function deriveBenchmarkAutonomyMetrics({ elapsedMs = 0, scope = {} } = {}) {
  const elapsedMinutes = Number((Math.max(0, Number(elapsedMs) || 0) / 60000).toFixed(2));
  const durationTargetMinutes = resolveBenchmarkDurationTargetMinutes(scope);
  const durationTargetMet = durationTargetMinutes == null ? null : elapsedMinutes >= durationTargetMinutes;
  const durationTargetGapMinutes = durationTargetMinutes == null
    ? null
    : Number(Math.max(0, durationTargetMinutes - elapsedMinutes).toFixed(2));
  return {
    elapsedMinutes,
    autonomyWindowMinutes: elapsedMinutes,
    durationTargetMinutes,
    durationTargetMet,
    durationTargetGapMinutes,
    endedBeforeDurationTarget: durationTargetMinutes != null && elapsedMinutes < durationTargetMinutes
  };
}

export function resolveBenchmarkMaxRuntimeMs({ scope = {}, env = process.env, fallbackMs = 5 * 60 * 1000, minimumMs = 60000 } = {}) {
  const durationTargetMinutes = resolveBenchmarkDurationTargetMinutes(scope);
  const envOverrideMs = Number(env?.TRANSFER_BENCHMARK_MAX_RUNTIME_MS || 0);
  const candidates = [minimumMs, fallbackMs];
  if (durationTargetMinutes != null) {
    const durationTargetMs = durationTargetMinutes * 60000;
    const graceMs = Math.max(30000, Math.min(5 * 60 * 1000, durationTargetMs * 0.05));
    candidates.push(durationTargetMs + graceMs);
  }
  if (Number.isFinite(envOverrideMs) && envOverrideMs > 0) candidates.push(envOverrideMs);
  return Math.max(...candidates);
}

function parsePositiveMilliseconds(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDeclaredVerifierDurationMs(command) {
  const text = String(command || '');
  const directEnv = text.match(/PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS\s*=\s*["']?(\d+)/);
  if (directEnv) return Number(directEnv[1]);
  const envDefault = text.match(/PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS\s*=\s*["']?\$\{[^}]*:-(\d+)\}/);
  if (envDefault) return Number(envDefault[1]);
  const cliDuration = text.match(/--duration-ms\s+(\d+)/);
  if (cliDuration) return Number(cliDuration[1]);
  return null;
}

export function resolveBenchmarkWorkerTimeoutMs({ scope = {}, env = process.env, maxRuntimeMs = null, fallbackMs = 5 * 60 * 1000, minimumMs = 10000 } = {}) {
  const explicit = parsePositiveMilliseconds(env?.TRANSFER_BENCHMARK_WORKER_TIMEOUT_MS)
    || parsePositiveMilliseconds(env?.ORCHESTRATOR_WORKER_TIMEOUT_MS)
    || parsePositiveMilliseconds(scope?.workerTimeoutMs);
  if (explicit != null) return Math.max(minimumMs, explicit);

  const scenarioDurationOverride = parsePositiveMilliseconds(env?.PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS_OVERRIDE)
    || parsePositiveMilliseconds(env?.PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS);
  const declaredVerifierDurations = (scope?.surfaces || [])
    .flatMap((surface) => surface?.verification || [])
    .map(parseDeclaredVerifierDurationMs)
    .filter((value) => Number.isFinite(value) && value > 0);
  const verifierDurationMs = scenarioDurationOverride
    || (declaredVerifierDurations.length ? Math.max(...declaredVerifierDurations) : null);

  const candidates = [minimumMs, fallbackMs];
  if (verifierDurationMs != null) {
    const graceMs = Math.max(30000, Math.min(5 * 60 * 1000, verifierDurationMs * 0.05));
    candidates.push(verifierDurationMs + graceMs);
  }
  if (Number.isFinite(Number(maxRuntimeMs)) && Number(maxRuntimeMs) > 0 && verifierDurationMs == null) {
    candidates.push(Number(maxRuntimeMs));
  }
  return Math.max(...candidates);
}

export function resolveBenchmarkLeaseTtlMs({ scope = {}, env = process.env, fallbackMs = 5000, minimumMs = 5000, maxRuntimeMs = null } = {}) {
  const envOverrideMs = Number(env?.TRANSFER_BENCHMARK_LEASE_TTL_MS || 0);
  if (Number.isFinite(envOverrideMs) && envOverrideMs > 0) {
    return Math.max(minimumMs, envOverrideMs);
  }

  const runtimeBudgetMs = Number.isFinite(Number(maxRuntimeMs)) && Number(maxRuntimeMs) > 0
    ? Number(maxRuntimeMs)
    : resolveBenchmarkMaxRuntimeMs({ scope, env, fallbackMs: Math.max(fallbackMs, 60_000), minimumMs: Math.max(minimumMs, 60_000) });

  return Math.max(minimumMs, fallbackMs, runtimeBudgetMs);
}

export const BENCHMARK_TIER_THRESHOLDS = Object.freeze({
  execution_smoke: Object.freeze({
    productiveIterationRate: Object.freeze({ min: 1 }),
    noOpRate: Object.freeze({ max: 0 }),
    repeatBlockerRate: Object.freeze({ max: 0 }),
    medianMinutesToMeaningfulProgress: Object.freeze({ max: 1 }),
    verificationIntegrity: Object.freeze({ eq: 1 }),
    handoffEfficiency: Object.freeze({ eq: 1 }),
    autonomyWindowMinutes: Object.freeze({ min: 0 }),
    truthIntegrityContradictions: Object.freeze({ eq: 0 }),
    fakeGreenIncidents: Object.freeze({ eq: 0 }),
    transferScore: Object.freeze({ min: 1 })
  }),
  tier1_smoke: Object.freeze({
    productiveIterationRate: Object.freeze({ min: 0.55 }),
    noOpRate: Object.freeze({ max: 0.20 }),
    repeatBlockerRate: Object.freeze({ max: 0.15 }),
    medianMinutesToMeaningfulProgress: Object.freeze({ max: 12 }),
    verificationIntegrity: Object.freeze({ eq: 1 }),
    handoffEfficiency: Object.freeze({ min: 0.60 }),
    autonomyWindowMinutes: Object.freeze({ min: 30 }),
    truthIntegrityContradictions: Object.freeze({ eq: 0 }),
    fakeGreenIncidents: Object.freeze({ eq: 0 })
  }),
  tier1_creative_product_30m: Object.freeze({
    productiveIterationRate: Object.freeze({ min: 0.55 }),
    noOpRate: Object.freeze({ max: 0.20 }),
    repeatBlockerRate: Object.freeze({ max: 0.15 }),
    medianMinutesToMeaningfulProgress: Object.freeze({ max: 12 }),
    verificationIntegrity: Object.freeze({ eq: 1 }),
    handoffEfficiency: Object.freeze({ min: 0.60 }),
    autonomyWindowMinutes: Object.freeze({ min: 30 }),
    truthIntegrityContradictions: Object.freeze({ eq: 0 }),
    fakeGreenIncidents: Object.freeze({ eq: 0 }),
    creativeWorkerEvidenceIntegrity: Object.freeze({ min: 1 }),
    creativeIterationIntegrity: Object.freeze({ min: 1 }),
    creativeProductDeltaIntegrity: Object.freeze({ min: 1 }),
    templateFallbackRate: Object.freeze({ max: 0 })
  }),
  tier2_functional: Object.freeze({
    productiveIterationRate: Object.freeze({ min: 0.65 }),
    noOpRate: Object.freeze({ max: 0.15 }),
    repeatBlockerRate: Object.freeze({ max: 0.10 }),
    medianMinutesToMeaningfulProgress: Object.freeze({ max: 15 }),
    verificationIntegrity: Object.freeze({ min: 0.95 }),
    handoffEfficiency: Object.freeze({ min: 0.70 }),
    autonomyWindowMinutes: Object.freeze({ min: 120 }),
    truthIntegrityContradictions: Object.freeze({ eq: 0 }),
    fakeGreenIncidents: Object.freeze({ eq: 0 }),
    transferScore: Object.freeze({ min: 0.70 })
  }),
  tier3_scale: Object.freeze({
    productiveIterationRate: Object.freeze({ min: 0.70 }),
    noOpRate: Object.freeze({ max: 0.10 }),
    repeatBlockerRate: Object.freeze({ max: 0.08 }),
    medianMinutesToMeaningfulProgress: Object.freeze({ max: 20 }),
    verificationIntegrity: Object.freeze({ min: 0.95 }),
    handoffEfficiency: Object.freeze({ min: 0.75 }),
    autonomyWindowMinutes: Object.freeze({ min: 240 }),
    truthIntegrityContradictions: Object.freeze({ eq: 0 }),
    fakeGreenIncidents: Object.freeze({ eq: 0 }),
    transferScore: Object.freeze({ min: 0.75 })
  })
});

function formatThresholdRequirement(rule) {
  if (Object.prototype.hasOwnProperty.call(rule, 'eq')) return `= ${rule.eq}`;
  if (Object.prototype.hasOwnProperty.call(rule, 'min')) return `>= ${rule.min}`;
  if (Object.prototype.hasOwnProperty.call(rule, 'max')) return `<= ${rule.max}`;
  return 'unknown';
}

function thresholdRuleSatisfied(actual, rule) {
  if (actual == null || Number.isNaN(actual)) return false;
  if (Object.prototype.hasOwnProperty.call(rule, 'eq')) return actual === rule.eq;
  if (Object.prototype.hasOwnProperty.call(rule, 'min')) return actual >= rule.min;
  if (Object.prototype.hasOwnProperty.call(rule, 'max')) return actual <= rule.max;
  return false;
}

export function evaluateBenchmarkThresholds({ benchmarkTier, metrics = {} }) {
  const thresholds = BENCHMARK_TIER_THRESHOLDS[benchmarkTier] || null;
  if (!thresholds) {
    return {
      ok: false,
      benchmarkTier,
      failures: [{ metric: 'benchmarkTier', actual: benchmarkTier || null, requirement: 'known benchmark tier', reason: 'unknown_benchmark_tier' }],
      thresholds: null
    };
  }

  const failures = [];
  for (const [metric, rule] of Object.entries(thresholds)) {
    const actual = metrics[metric] ?? null;
    if (actual == null || Number.isNaN(actual)) {
      failures.push({
        metric,
        actual,
        requirement: formatThresholdRequirement(rule),
        reason: 'missing_metric_evidence'
      });
      continue;
    }
    if (!thresholdRuleSatisfied(actual, rule)) {
      failures.push({
        metric,
        actual,
        requirement: formatThresholdRequirement(rule),
        reason: 'threshold_not_met'
      });
    }
  }

  return {
    ok: failures.length === 0,
    benchmarkTier,
    failures,
    thresholds
  };
}

export function createScoreboardRow({ contract, metrics = {}, outcome = {}, durationMinutes = null, blockerFamily = null, blockerSemantics = 'none', notes = '' }) {
  return {
    runId: contract.runId,
    benchmarkId: contract.benchmarkId,
    tier: contract.benchmarkTier,
    repoPath: contract.repoPath,
    requestedAgentCount: contract.requestedAgentCount,
    durationMinutes,
    productiveIterationRate: metrics.productiveIterationRate ?? null,
    noOpRate: metrics.noOpRate ?? null,
    repeatBlockerRate: metrics.repeatBlockerRate ?? null,
    medianMinutesToMeaningfulProgress: metrics.medianMinutesToMeaningfulProgress ?? null,
    verificationIntegrity: metrics.verificationIntegrity ?? null,
    handoffEfficiency: metrics.handoffEfficiency ?? null,
    autonomyWindowMinutes: metrics.autonomyWindowMinutes ?? null,
    truthIntegrityContradictions: metrics.truthIntegrityContradictions ?? 0,
    fakeGreenIncidents: metrics.fakeGreenIncidents ?? 0,
    transferScore: metrics.transferScore ?? null,
    pass: outcome.pass ?? false,
    mechanicalGreen: outcome.mechanicalGreen ?? null,
    scaleProofReady: outcome.scaleProofReady ?? null,
    thresholdFailures: outcome.thresholdFailures ?? [],
    blockerFamily,
    blockerSemantics,
    notes
  };
}

export function readBenchmarkScoreboard(scoreboardPath) {
  return readJson(scoreboardPath, {
    schemaVersion: 'claw.agent_benchmark_scoreboard.v1',
    generatedAt: null,
    rows: []
  });
}

export function upsertBenchmarkScoreboardRow({ scoreboardPath, row }) {
  const scoreboard = readBenchmarkScoreboard(scoreboardPath);
  scoreboard.generatedAt = new Date().toISOString();
  scoreboard.rows = (scoreboard.rows || []).filter((entry) => entry.runId !== row.runId);
  scoreboard.rows.push(row);
  scoreboard.rows.sort((a, b) => String(a.runId).localeCompare(String(b.runId)));
  writeJson(scoreboardPath, scoreboard);
  return scoreboard;
}

function classifyBenchmarkRow(row) {
  if (row.pass) return 'trusted_threshold_pass';
  if (row.mechanicalGreen && row.scaleProofReady) return 'mechanical_green_threshold_red';
  if (row.blockerSemantics === 'baseline_ready') return 'baseline_ready';
  if (row.blockerFamily === 'insufficient_parallel_surface_inventory') return 'scope_limited';
  return 'blocked_or_unqualified';
}

export function buildBenchmarkGroundTruth(scoreboard) {
  const rows = scoreboard?.rows || [];
  const byBenchmark = new Map();
  for (const row of rows) {
    const key = row.benchmarkId || 'unknown_benchmark';
    if (!byBenchmark.has(key)) byBenchmark.set(key, []);
    byBenchmark.get(key).push(row);
  }

  const benchmarks = Array.from(byBenchmark.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([benchmarkId, benchmarkRows]) => {
    const rowsSorted = [...benchmarkRows].sort((a, b) => String(a.runId).localeCompare(String(b.runId)));
    const latest = rowsSorted[rowsSorted.length - 1] || null;
    const latestTrustedPass = [...rowsSorted].reverse().find((row) => row.pass) || null;
    const latestMechanical = [...rowsSorted].reverse().find((row) => row.mechanicalGreen && row.scaleProofReady) || null;
    return {
      benchmarkId,
      tiers: Array.from(new Set(rowsSorted.map((row) => row.tier).filter(Boolean))),
      runCount: rowsSorted.length,
      latestRunId: latest?.runId || null,
      latestStatus: latest ? classifyBenchmarkRow(latest) : 'missing',
      latestNotes: latest?.notes || null,
      trustedPassRunId: latestTrustedPass?.runId || null,
      trustedPassCount: rowsSorted.filter((row) => row.pass).length,
      latestMechanicalGreenRunId: latestMechanical?.runId || null,
      mechanicalGreenCount: rowsSorted.filter((row) => row.mechanicalGreen && row.scaleProofReady).length,
      blockerFamilies: Array.from(new Set(rowsSorted.map((row) => row.blockerFamily).filter(Boolean))),
      thresholdFailureMetrics: Array.from(new Set(rowsSorted.flatMap((row) => (row.thresholdFailures || []).map((failure) => failure.metric)).filter(Boolean)))
    };
  });

  return {
    schemaVersion: 'claw.agent_benchmark_ground_truth.v1',
    generatedAt: new Date().toISOString(),
    scoreboardGeneratedAt: scoreboard?.generatedAt || null,
    benchmarkCount: benchmarks.length,
    trustedThresholdPassCount: rows.filter((row) => row.pass).length,
    mechanicalGreenCount: rows.filter((row) => row.mechanicalGreen && row.scaleProofReady).length,
    benchmarksWithoutTrustedPass: benchmarks.filter((entry) => !entry.trustedPassRunId).map((entry) => entry.benchmarkId),
    benchmarks
  };
}

export function bootstrapTransferBenchmark({
  benchmarkId,
  benchmarkTier = 'tier1_smoke',
  benchmarkClass = 'brownfield_product_transfer',
  fidelity = 'production_slice',
  repoPath,
  scope = {},
  verifierSet = [],
  requestedAgentCount = 10,
  executionBoundary = 'local_or_remote',
  scoreboardPath,
  artifactRoot,
  notes = '',
  replyAnchor = '',
  status = 'prepared'
}) {
  const contract = createBenchmarkRunContract({
    benchmarkId,
    benchmarkTier,
    benchmarkClass,
    fidelity,
    scope,
    repoPath,
    verifierSet,
    requestedAgentCount,
    executionBoundary,
    scoreboardPath: scoreboardPath || path.join('artifacts', 'benchmarks', 'scoreboard.json'),
    artifactRoot,
    notes,
    replyAnchor
  });

  const root = path.resolve(contract.artifactRoot);
  fs.mkdirSync(root, { recursive: true });

  const surfaceMatrix = {
    schemaVersion: 'claw.agent_benchmark_surface_matrix.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    repoPath: contract.repoPath,
    status,
    surfaces: scope.surfaces || []
  };
  const scoreboardRow = createScoreboardRow({
    contract,
    outcome: { pass: false },
    blockerSemantics: 'none',
    notes: 'Bootstrap row created. Benchmark not yet executed.'
  });

  writeJson(path.join(root, 'run_contract.json'), contract);
  writeJson(path.join(root, 'surface_matrix.json'), surfaceMatrix);
  writeJson(path.join(root, 'program_state.json'), {
    schemaVersion: 'claw.agent_benchmark_program_state.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    status: 'prepared',
    done: false,
    stopAllowed: false,
    summary: 'Benchmark scaffold initialized.'
  });
  writeJson(path.join(root, 'supervisor_status.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    supervisorStatus: 'pending',
    matrixStatus: 'pending',
    note: 'Benchmark has not been executed yet.'
  });
  writeJson(path.join(root, 'completion_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    pass: false,
    supervisorConfirmedCompletion: false,
    note: 'Bootstrap scaffold only. No execution yet.'
  });
  writeJson(path.join(root, 'scoreboard_row.json'), scoreboardRow);
  writeJson(path.join(root, 'iteration_ledger.json'), []);
  writeJson(path.join(root, 'verifier_evidence.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    verifiers: verifierSet,
    executions: []
  });
  writeJson(path.join(root, 'intervention_log.json'), []);
  writeJson(path.join(root, 'truth_conflicts.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    contradictions: []
  });
  writeJson(path.join(root, 'notifier_eligibility.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    eligible: false,
    kind: 'bootstrap',
    note: 'Notifications are disabled until the benchmark has executed.'
  });

  return {
    contract,
    root,
    scoreboardRow,
    surfaceMatrix
  };
}
