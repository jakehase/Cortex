#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRunContractTemplate, bootstrapTransferBenchmark, upsertBenchmarkScoreboardRow } from '../../packages/system-benchmark/index.mjs';
import { PMHNP_TIER2_SCENARIOS } from './pmhnp-tier2-scenarios.mjs';

function moduleSurface(id, label, filePath, verifierScriptPath) {
  return {
    id,
    label,
    allowedFiles: [filePath],
    verification: [`node ${verifierScriptPath} ${filePath}`]
  };
}

function enduranceScenarioCommand({ verifierScriptPath, scenarioId, durationMs, minCycles = 2 }) {
  return [
    `PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS="\${PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS_OVERRIDE:-${durationMs}}"`,
    `PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES="\${PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES_OVERRIDE:-${minCycles}}"`,
    'node',
    verifierScriptPath,
    scenarioId
  ].join(' ');
}

function functionalSurface(scenario, verifierScriptPath, options = {}) {
  return {
    id: scenario.id,
    label: scenario.label,
    allowedFiles: scenario.allowedFiles,
    verification: [enduranceScenarioCommand({
      verifierScriptPath,
      scenarioId: scenario.id,
      durationMs: Math.max(1, Number(options.durationMs || 1)),
      minCycles: Math.max(1, Number(options.minCycles || 2))
    })]
  };
}

function waveAwareDurationTargetMinutes({ scenarioCount, requestedAgentCount, perWaveMinutes = 30, maxMinutes = null }) {
  const waves = Math.max(1, Math.ceil(Math.max(1, Number(scenarioCount || 0)) / Math.max(1, Number(requestedAgentCount || 1))));
  const durationMinutes = waves * perWaveMinutes;
  return maxMinutes == null ? durationMinutes : Math.min(maxMinutes, durationMinutes);
}

function buildPreset(name, stackRoot) {
  const verifierScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-module-load.mjs');
  const tier2ScenarioScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-pmhnp-functional-scenario.mjs');
  const tier2CatalogScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-pmhnp-functional-catalog.mjs');
  const tier1RequestedAgentCount = 10;
  const presets = {
    pmhnp_denial_copilot_transfer: {
      benchmarkId: 'pmhnp_denial_copilot_transfer',
      benchmarkTier: 'tier1_smoke',
      benchmarkClass: 'brownfield_product_transfer',
      fidelity: 'production_slice',
      repoPath: '/root/clawd/pmhnp-denial-copilot',
      executionBoundary: 'remote_execution_required',
      requestedAgentCount: tier1RequestedAgentCount,
      notes: 'Tier-1 endurance-capable transfer smoke benchmark for the PMHNP denial copilot. Each shard replays a real low-overlap functional workflow continuously for the declared window, so autonomy claims are tied to sustained verifier-backed execution rather than instant module loads. The runtime target is wave-aware so a 10-agent pool can finish the full scenario set honestly.',
      replyAnchor: 'Jake asked for the first actual transfer benchmark setup after defining the orchestration benchmark program, then asked to keep going until we got a good result.',
      scope: {
        durationTargetMinutes: waveAwareDurationTargetMinutes({
          scenarioCount: PMHNP_TIER2_SCENARIOS.length,
          requestedAgentCount: tier1RequestedAgentCount
        }),
        surfaces: PMHNP_TIER2_SCENARIOS.map((scenario) => functionalSurface(scenario, tier2ScenarioScriptPath, {
          durationMs: 30 * 60 * 1000,
          minCycles: 2
        }))
      },
      verifierSet: [
        {
          kind: 'node_script',
          command: 'node scripts/smoke-test.mjs',
          purpose: 'Whole-runtime smoke proof that the PMHNP denial copilot still boots and serves key flows.'
        },
        {
          kind: 'functional_catalog',
          command: `node ${tier2CatalogScriptPath}`,
          purpose: 'One-pass proof that the full PMHNP functional scenario catalog is runnable before endurance benchmarking.'
        }
      ]
    },
    pmhnp_denial_copilot_transfer_tier2: {
      benchmarkId: 'pmhnp_denial_copilot_transfer_tier2',
      benchmarkTier: 'tier2_functional',
      benchmarkClass: 'brownfield_product_transfer',
      fidelity: 'production_slice',
      repoPath: '/root/clawd/pmhnp-denial-copilot',
      executionBoundary: 'remote_execution_required',
      requestedAgentCount: 10,
      notes: 'Tier-2 endurance transfer benchmark for the PMHNP denial copilot. Each shard continuously replays one real workflow against a low-overlap surface, so long-window autonomy claims reflect sustained functional execution on the transfer repo. The wall-clock runtime target is wave-aware so a 10-agent pool can finish the full scenario set honestly.',
      replyAnchor: 'Jake asked to turn the PMHNP benchmark into a stronger tier2 functional transfer benchmark after the tier1 smoke benchmark passed.',
      scope: {
        durationTargetMinutes: waveAwareDurationTargetMinutes({
          scenarioCount: PMHNP_TIER2_SCENARIOS.length,
          requestedAgentCount: 10,
          perWaveMinutes: 120
        }),
        surfaces: PMHNP_TIER2_SCENARIOS.map((scenario) => functionalSurface(scenario, tier2ScenarioScriptPath, {
          durationMs: 120 * 60 * 1000,
          minCycles: 3
        }))
      },
      verifierSet: [
        {
          kind: 'node_script',
          command: 'node scripts/smoke-test.mjs',
          purpose: 'Whole-runtime smoke proof that the PMHNP denial copilot still boots and serves key flows.'
        },
        {
          kind: 'functional_catalog',
          command: `node ${tier2CatalogScriptPath}`,
          purpose: 'Serial proof that the full tier2 functional scenario catalog is runnable before concurrency benchmarking.'
        }
      ]
    }
  };
  return presets[name] || null;
}

const presetName = process.argv[2] || 'pmhnp_denial_copilot_transfer';
const stackRoot = path.resolve(process.argv[3] || '/root/clawd/large-project-capability-stack');
const preset = buildPreset(presetName, stackRoot);
if (!preset) {
  console.error(`Unknown preset: ${presetName}`);
  console.error('Available presets: pmhnp_denial_copilot_transfer, pmhnp_denial_copilot_transfer_tier2');
  process.exit(1);
}
const scoreboardPath = path.join(stackRoot, 'artifacts/benchmarks/scoreboard.json');
const artifactRoot = path.join(stackRoot, 'artifacts/benchmarks', preset.benchmarkId, `bootstrap-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}`);
const templatePath = path.join(stackRoot, 'apps/system-benchmark/templates/benchmark-run-contract.template.json');

fs.mkdirSync(path.dirname(templatePath), { recursive: true });
if (!fs.existsSync(templatePath)) {
  fs.writeFileSync(templatePath, `${JSON.stringify(benchmarkRunContractTemplate(), null, 2)}\n`);
}

const scaffold = bootstrapTransferBenchmark({
  ...preset,
  artifactRoot,
  scoreboardPath
});

upsertBenchmarkScoreboardRow({
  scoreboardPath,
  row: scaffold.scoreboardRow
});

const summaryPath = path.join(scaffold.root, 'README.md');
fs.writeFileSync(summaryPath, `# ${preset.benchmarkId}\n\n- Repo: ${preset.repoPath}\n- Tier: ${preset.benchmarkTier}\n- Fidelity: ${preset.fidelity}\n- Run id: ${scaffold.contract.runId}\n- Scoreboard: ${scoreboardPath}\n- Template: ${templatePath}\n\nThis is a prepared transfer benchmark scaffold. Execute the declared verifier(s), then update the scoreboard row with real benchmark results.\n`);

console.log(JSON.stringify({
  ok: true,
  preset: presetName,
  artifactRoot: scaffold.root,
  runContractPath: path.join(scaffold.root, 'run_contract.json'),
  surfaceMatrixPath: path.join(scaffold.root, 'surface_matrix.json'),
  scoreboardPath,
  scoreboardRowPath: path.join(scaffold.root, 'scoreboard_row.json'),
  templatePath,
  runId: scaffold.contract.runId
}, null, 2));
