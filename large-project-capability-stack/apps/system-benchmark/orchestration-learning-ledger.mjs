#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  createLearningLedger,
  normalizeLearningArtifact,
  promoteLearningFromRun,
  readLearningLedger,
  retrieveLearningPatterns,
  upsertLearningArtifact,
  writeLearningLedger
} from '../../packages/orchestration-learning-ledger/index.mjs';

function usage() {
  console.error(`usage:
  node apps/system-benchmark/orchestration-learning-ledger.mjs init --ledger PATH [--project NAME]
  node apps/system-benchmark/orchestration-learning-ledger.mjs add --ledger PATH --kind architecture_pattern|anti_pattern|repair_strategy --title TITLE [--files a,b] [--agent-work FILE]
  node apps/system-benchmark/orchestration-learning-ledger.mjs promote-run --ledger PATH --run-root ROOT [--project NAME]
  node apps/system-benchmark/orchestration-learning-ledger.mjs retrieve --ledger PATH [--surface-json FILE] [--files a,b] [--lane LANE] [--out FILE]
`);
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const next = rest[index + 1];
    if (token === '--ledger') { args.ledger = path.resolve(next); index += 1; continue; }
    if (token === '--project') { args.project = next; index += 1; continue; }
    if (token === '--kind') { args.kind = next; index += 1; continue; }
    if (token === '--title') { args.title = next; index += 1; continue; }
    if (token === '--summary') { args.summary = next; index += 1; continue; }
    if (token === '--files') { args.files = String(next || '').split(',').map((entry) => entry.trim()).filter(Boolean); index += 1; continue; }
    if (token === '--verifiers') { args.verifiers = String(next || '').split(',').map((entry) => entry.trim()).filter(Boolean); index += 1; continue; }
    if (token === '--routes') { args.routeNamespaces = String(next || '').split(',').map((entry) => entry.trim()).filter(Boolean); index += 1; continue; }
    if (token === '--lane') { args.lane = next; index += 1; continue; }
    if (token === '--domain') { args.domain = next; index += 1; continue; }
    if (token === '--trust') { args.trust = next; index += 1; continue; }
    if (token === '--agent-work') { args.agentWork = fs.readFileSync(path.resolve(next), 'utf8'); index += 1; continue; }
    if (token === '--run-root') { args.runRoot = path.resolve(next); index += 1; continue; }
    if (token === '--patch-queue') { args.patchQueue = path.resolve(next); index += 1; continue; }
    if (token === '--quality-gate') { args.qualityGate = path.resolve(next); index += 1; continue; }
    if (token === '--surface-json') { args.surfaceJson = path.resolve(next); index += 1; continue; }
    if (token === '--limit') { args.limit = Number(next); index += 1; continue; }
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--json') { args.json = true; continue; }
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeOutput(args, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, text);
  }
  console.log(text.trimEnd());
}

const args = parseArgs(process.argv.slice(2));
if (!args.command || !['init', 'add', 'promote-run', 'retrieve'].includes(args.command)) usage();
if (!args.ledger) usage();

if (args.command === 'init') {
  const existing = fs.existsSync(args.ledger) ? readLearningLedger(args.ledger) : createLearningLedger({ project: args.project || 'orchestration' });
  if (args.project) existing.project = args.project;
  writeLearningLedger(args.ledger, existing);
  writeOutput(args, { ok: true, action: 'init', ledgerPath: args.ledger, summary: { architecturePatterns: existing.architecturePatterns.length, antiPatterns: existing.antiPatterns.length, repairStrategies: existing.repairStrategies.length } });
  process.exit(0);
}

if (args.command === 'add') {
  const ledger = fs.existsSync(args.ledger) ? readLearningLedger(args.ledger) : createLearningLedger({ project: args.project || 'orchestration' });
  const artifact = normalizeLearningArtifact({
    kind: args.kind || 'architecture_pattern',
    title: args.title || args.kind || 'learned pattern',
    summary: args.summary || args.title || '',
    files: args.files || [],
    verifiers: args.verifiers || [],
    routeNamespaces: args.routeNamespaces || [],
    lane: args.lane || '',
    domain: args.domain || '',
    trust: args.trust || 'trusted',
    agentWork: args.agentWork || '',
    project: args.project || ledger.project,
    source: 'manual_cli'
  });
  const next = upsertLearningArtifact(ledger, artifact);
  writeLearningLedger(args.ledger, next);
  writeOutput(args, { ok: true, action: 'add', ledgerPath: args.ledger, artifact });
  process.exit(0);
}

if (args.command === 'promote-run') {
  if (!args.runRoot && (!args.patchQueue || !args.qualityGate)) usage();
  const runRoot = args.runRoot || path.dirname(path.dirname(args.patchQueue));
  const patchQueuePath = args.patchQueue || path.join(runRoot, 'orchestrator_run', 'patch_queue.json');
  const qualityGatePath = args.qualityGate || path.join(runRoot, 'production_quality_gate.json');
  const completion = readJson(path.join(runRoot, 'completion_summary.json'), {});
  const patchQueue = readJson(patchQueuePath, {});
  const qualityGate = readJson(qualityGatePath, {});
  const ledger = fs.existsSync(args.ledger) ? readLearningLedger(args.ledger) : createLearningLedger({ project: args.project || completion.benchmarkId || 'orchestration' });
  const { ledger: next, artifacts } = promoteLearningFromRun({
    ledger,
    patchQueue,
    productionQualityGate: qualityGate,
    runRoot,
    benchmarkId: completion.benchmarkId || '',
    runId: completion.runId || '',
    project: args.project || ledger.project || completion.benchmarkId || 'orchestration'
  });
  writeLearningLedger(args.ledger, next);
  writeOutput(args, { ok: true, action: 'promote-run', ledgerPath: args.ledger, runRoot, patchQueuePath, qualityGatePath, promotedArtifactCount: artifacts.length, artifacts });
  process.exit(0);
}

if (args.command === 'retrieve') {
  const ledger = readLearningLedger(args.ledger);
  const surface = args.surfaceJson ? readJson(args.surfaceJson, {}) : {};
  const query = {
    ...surface,
    files: args.files || surface.files || surface.allowedFiles || surface.productFiles || [],
    lane: args.lane || surface.lane || surface.metadata?.lane || '',
    domain: args.domain || surface.domain || surface.metadata?.domain || '',
    routeNamespaces: args.routeNamespaces || surface.routeNamespaces || surface.metadata?.routeNamespaces || []
  };
  const result = retrieveLearningPatterns({ ledger, query, limit: args.limit || 3 });
  writeOutput(args, { ok: true, action: 'retrieve', ledgerPath: args.ledger, result });
  process.exit(0);
}
