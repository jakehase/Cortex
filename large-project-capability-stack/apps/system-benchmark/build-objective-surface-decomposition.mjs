#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  buildObjectiveExpansionPlan,
  decomposeObjectiveToArchitectureEpics,
  decomposeObjectiveToSurfaces,
  renderArchitectureEpicReport,
  renderObjectiveDecompositionReport
} from '../../packages/objective-surface-decomposer/index.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--objective') args.objective = argv[++index];
    else if (token === '--objective-id') args.objectiveId = argv[++index];
    else if (token === '--fidelity') args.fidelity = argv[++index];
    else if (token === '--requested-agent-count') args.requestedAgentCount = Number(argv[++index]);
    else if (token === '--max-surfaces') args.maxSurfaces = Number(argv[++index]);
    else if (token === '--architecture-epics') args.architectureEpics = true;
    else if (token === '--expansion') args.expansion = true;
    else if (token === '--current-surface-matrix') args.currentSurfaceMatrix = argv[++index];
    else if (token === '--current-work-count') args.currentWorkCount = Number(argv[++index]);
    else if (token === '--scope-already-satisfied') args.scopeAlreadySatisfied = true;
    else if (token === '--supervisor-status') args.supervisorStatus = argv[++index];
    else if (token === '--matrix-status') args.matrixStatus = argv[++index];
    else if (token === '--parity-status') args.parityStatus = argv[++index];
    else if (token === '--blocker-kind') args.blockerKind = argv[++index];
    else if (token === '--completed-surface-ids') args.completedSurfaceIds = argv[++index];
    else if (token === '--stage') args.stage = argv[++index];
    else if (token === '--target-epics') args.targetEpics = argv[++index];
    else if (token === '--max-epics') args.maxEpics = Number(argv[++index]);
    else if (token === '--out') args.out = argv[++index];
    else args._.push(token);
  }
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  console.error('usage: node apps/system-benchmark/build-objective-surface-decomposition.mjs <repoPath> --objective "large product objective" [--requested-agent-count 100] [--out artifactRoot]');
  process.exit(1);
}

function readJson(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch {
    return fallback;
  }
}

const args = parseArgs(process.argv.slice(2));
const repoPath = args._[0];
if (!repoPath || !args.objective) usage();

const artifactRoot = path.resolve(args.out || path.join(process.cwd(), 'artifacts', 'objective-surface-decomposition', new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')));
const objective = {
  id: args.objectiveId || null,
  title: args.objective,
  requestedFidelity: args.fidelity || 'production_slice'
};
const targetEpicIds = String(args.targetEpics || '').split(',').map((entry) => entry.trim()).filter(Boolean);
const decomposition = args.expansion
  ? buildObjectiveExpansionPlan({
    repoPath,
    objective,
    requestedAgentCount: Number.isFinite(args.requestedAgentCount) ? args.requestedAgentCount : null,
    architectureEpics: args.architectureEpics === true,
    targetEpicIds,
    maxEpics: Number.isFinite(args.maxEpics) ? args.maxEpics : null,
    stage: args.stage || 'dynamic_objective_expansion',
    currentSurfaceMatrix: readJson(args.currentSurfaceMatrix, null),
    currentWorkCount: Number.isFinite(args.currentWorkCount) ? args.currentWorkCount : null,
    scopeAlreadySatisfied: args.scopeAlreadySatisfied === true,
    completedSurfaceIds: String(args.completedSurfaceIds || '').split(',').map((entry) => entry.trim()).filter(Boolean),
    supervisorState: {
      status: args.supervisorStatus || null,
      matrixStatus: args.matrixStatus || null,
      parityStatus: args.parityStatus || null,
      blockerKind: args.blockerKind || null,
      requestedFidelity: args.fidelity || null
    }
  })
  : args.architectureEpics
  ? decomposeObjectiveToArchitectureEpics({
    repoPath,
    objective,
    requestedAgentCount: Number.isFinite(args.requestedAgentCount) ? args.requestedAgentCount : null,
    targetEpicIds,
    maxEpics: Number.isFinite(args.maxEpics) ? args.maxEpics : null,
    stage: args.stage || 'full_clone_relaunch_readiness'
  })
  : decomposeObjectiveToSurfaces({
  repoPath,
  objective,
  requestedAgentCount: Number.isFinite(args.requestedAgentCount) ? args.requestedAgentCount : null,
  maxSurfaces: Number.isFinite(args.maxSurfaces) ? args.maxSurfaces : 200
  });

if (decomposition.surfaceGraph) writeJson(path.join(artifactRoot, 'surface_inventory.json'), decomposition.surfaceGraph);
if (decomposition.architectureEpicPlan) writeJson(path.join(artifactRoot, 'architecture_epic_plan.json'), decomposition.architectureEpicPlan);
if (decomposition.survey) writeJson(path.join(artifactRoot, 'repo_survey.json'), decomposition.survey);
if (decomposition.negativeSpace) writeJson(path.join(artifactRoot, 'negative_space_inventory.json'), decomposition.negativeSpace);
writeJson(path.join(artifactRoot, 'surface_matrix.json'), decomposition.surfaceMatrix);
writeJson(path.join(artifactRoot, 'work_graph.json'), decomposition.workGraph);
if (args.expansion) writeJson(path.join(artifactRoot, 'objective_expansion_plan.json'), decomposition);
writeJson(path.join(artifactRoot, 'decomposition_summary.json'), {
  schemaVersion: decomposition.schemaVersion,
  generatedAt: decomposition.generatedAt,
  repoPath: decomposition.repoPath,
  objective: decomposition.objective,
  requestedAgentCount: decomposition.requestedAgentCount,
  status: decomposition.status,
  summary: decomposition.summary || decomposition.decompositionSummary || {
    expansionSurfaceCount: decomposition.expansionSurfaceCount,
    expansionWorkUnitCount: decomposition.expansionWorkUnitCount,
    shouldExpand: decomposition.shouldExpand,
    reason: decomposition.reason
  },
  blocker: decomposition.blocker
});
fs.writeFileSync(path.join(artifactRoot, 'report.md'), args.expansion
  ? `# Objective Expansion Plan\n\n- Generated at: ${decomposition.generatedAt}\n- Objective: ${decomposition.objective.title}\n- Mode: ${decomposition.mode}\n- Should expand: ${decomposition.shouldExpand}\n- Reason: ${decomposition.reason}\n- Expansion surfaces: ${decomposition.expansionSurfaceCount}\n- Expansion work units: ${decomposition.expansionWorkUnitCount}\n- Truth boundary: ${decomposition.truthBoundary}\n`
  : args.architectureEpics ? renderArchitectureEpicReport(decomposition) : renderObjectiveDecompositionReport(decomposition));
if (decomposition.blocker) {
  writeJson(path.join(artifactRoot, 'blocker_report.json'), {
    generatedAt: decomposition.generatedAt,
    phase: 'objective_surface_decomposition',
    status: 'blocked',
    blocker: decomposition.blocker.type,
    nextAction: decomposition.blocker.nextAction,
    details: decomposition.blocker
  });
}

console.log(JSON.stringify({
  ok: args.expansion ? decomposition.shouldExpand === true && !decomposition.blocker : !decomposition.blocker,
  artifactRoot,
  status: decomposition.status || (decomposition.shouldExpand ? 'expansion_planned' : 'expansion_not_required'),
  surfaceCount: decomposition.summary?.surfaceCount || decomposition.summary?.epicCount || decomposition.expansionSurfaceCount || 0,
  lowOverlapSurfaceCount: decomposition.summary?.lowOverlapSurfaceCount || decomposition.summary?.readyEpicCount || decomposition.expansionWorkUnitCount || 0,
  architectureEpicMode: args.architectureEpics === true,
  objectiveExpansionMode: args.expansion === true,
  shouldExpand: decomposition.shouldExpand ?? null,
  expansionReason: decomposition.reason || null,
  architectureEpicSummary: decomposition.architectureEpicPlan?.workGraph?.summary || null,
  blocker: decomposition.blocker
}, null, 2));
process.exit(0);
