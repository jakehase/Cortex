import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeCortexAgentWorkHandoff } from '../cortex-agent-work-adapter/index.mjs';
import { upgradeAgentWorkV0ToV1, writeAgentWorkV1Contracts } from './contracts.mjs';

export const CANONICAL_PIPELINE_SCHEMA = 'clawd.canonical_agent_work_pipeline.v0';

export const CANONICAL_PIPELINE = Object.freeze({
  schemaVersion: CANONICAL_PIPELINE_SCHEMA,
  stages: Object.freeze([
    { id: 'interaction', owner: 'openclaw', responsibility: 'user intent, approvals, reliable delivery' },
    { id: 'planning', owner: 'cortex', responsibility: 'grounding, routing, policy, supervision' },
    { id: 'contract', owner: 'agent_work', responsibility: 'run contract, surface matrix, work graph' },
    { id: 'execution', owner: 'codex_workers', responsibility: 'isolated product implementation on execution plane' },
    { id: 'verification', owner: 'independent_verifier', responsibility: 'acceptance, negative-space, claim truth' },
    { id: 'delivery', owner: 'openclaw', responsibility: 'artifact-backed completion or blocker' }
  ]),
  compatibilityOnly: Object.freeze(['synthetic_labor_os_v19', 'synthetic_labor_os_v20_rc', 'ai_os_adapter']),
  forbiddenAsCanonicalRuntime: Object.freeze(['synthetic_labor_os_v1_v18', 'direct_codex_wrappers', 'artifact_snapshot_repos'])
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

export function compileCanonicalAgentWork({ input, outputDir, options = {} } = {}) {
  if (!input || typeof input !== 'object') throw new Error('canonical Agent Work input is required');
  if (!outputDir) throw new Error('outputDir is required');
  const compiled = writeCortexAgentWorkHandoff({ input, outputDir, options });
  const boundary = String(compiled.runContract.executionBoundary || compiled.handoff.executionBoundary || 'control_plane_allowed');
  const manifest = {
    schemaVersion: CANONICAL_PIPELINE_SCHEMA,
    generatedAt: new Date().toISOString(),
    pipeline: CANONICAL_PIPELINE,
    runId: compiled.runContract.runId,
    objective: compiled.handoff.objective,
    fidelity: compiled.handoff.fidelity,
    executionBoundary: boundary,
    host: os.hostname(),
    hostRole: process.env.BENCHMARK_HOST_ROLE || 'control_plane',
    artifactRoot: path.resolve(outputDir),
    compileGreen: compiled.validation.ok === true,
    executeAllowedHere: boundary !== 'remote_execution_required' || process.env.BENCHMARK_HOST_ROLE === 'execution_plane',
    controller: 'apps/system-benchmark/run-agent-work-objective-controller.mjs',
    runContractPath: compiled.files.runContractPath,
    truthBoundary: 'Compilation proves a grounded Agent Work contract. It does not prove worker execution, accepted product changes, parity, or completion.'
  };
  const v1Contracts = upgradeAgentWorkV0ToV1({ handoff: compiled.handoff, runContract: compiled.runContract, canonicalManifest: manifest });
  manifest.contractBundleSchemaVersion = v1Contracts.schemaVersion;
  manifest.contractFreezeGreen = v1Contracts.validation.ok;
  manifest.compileGreen = manifest.compileGreen && v1Contracts.validation.ok;
  const v1ContractFiles = writeAgentWorkV1Contracts({ bundle: v1Contracts, outputDir });
  const manifestPath = writeJson(path.join(outputDir, 'canonical_pipeline_manifest.json'), manifest);
  return { ...compiled, canonicalManifest: manifest, manifestPath, v1Contracts, v1ContractFiles };
}

export function executeCanonicalAgentWork({ compilation, artifactRoot, dryRun = false, stackRoot } = {}) {
  if (!compilation?.canonicalManifest) throw new Error('canonical compilation is required');
  if (!compilation.canonicalManifest.executeAllowedHere) {
    return { ok: false, blocked: true, blockerFamily: 'remote_execution_boundary_required', message: 'Heavy Agent Work execution is not allowed on the control-plane host.' };
  }
  const root = path.resolve(stackRoot || new URL('../..', import.meta.url).pathname);
  const controller = path.join(root, 'apps/system-benchmark/run-agent-work-objective-controller.mjs');
  const args = [controller, compilation.files.runContractPath, '--artifact-root', path.resolve(artifactRoot || path.join(path.dirname(compilation.files.runContractPath), 'run'))];
  if (dryRun) args.push('--dry-run');
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: process.env });
  const result = {
    schemaVersion: 'clawd.canonical_agent_work_execution.v0',
    startedAt,
    completedAt: new Date().toISOString(),
    ok: run.status === 0,
    blocked: false,
    exitCode: run.status,
    signal: run.signal,
    stdout: run.stdout,
    stderr: run.stderr,
    controller,
    runContractPath: compilation.files.runContractPath
  };
  writeJson(path.join(path.dirname(compilation.files.runContractPath), 'canonical_execution_result.json'), result);
  return result;
}
