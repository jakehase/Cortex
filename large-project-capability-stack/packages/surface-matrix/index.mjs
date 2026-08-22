import fs from 'node:fs';
import path from 'node:path';

function issueLookup(graph, id) {
  return graph.issues.find((issue) => issue.id === id) || null;
}

function surfaceStatus(surface, graph) {
  const issues = surface.issueIds.map((id) => issueLookup(graph, id)).filter(Boolean);
  const artifactPaths = surface.requiredArtifacts || [];
  const artifactsPresent = artifactPaths.every((file) => fs.existsSync(file));
  if (issues.some((issue) => issue.status === 'blocked')) return { status: 'blocked', artifactsPresent };
  if (issues.length > 0 && issues.every((issue) => issue.status === 'complete') && artifactsPresent) return { status: 'all_complete', artifactsPresent };
  return { status: 'partial', artifactsPresent };
}

export function compileSurfaceMatrix({ contract, graph, surfaces }) {
  const derivedSurfaces = surfaces || graph.issues.filter((issue) => !issue.parentId).map((issue) => ({
    id: issue.id,
    label: issue.title,
    issueIds: [issue.id],
    requiredArtifacts: issue.artifacts || []
  }));
  const entries = derivedSurfaces.map((surface) => {
    const result = surfaceStatus(surface, graph);
    return {
      ...surface,
      status: result.status,
      artifactsPresent: result.artifactsPresent,
      issues: surface.issueIds.map((id) => issueLookup(graph, id)).filter(Boolean)
    };
  });
  const status = entries.every((entry) => entry.status === 'all_complete')
    ? 'all_complete'
    : entries.some((entry) => entry.status === 'blocked')
      ? 'blocked'
      : 'partial';
  return {
    generatedAt: new Date().toISOString(),
    contractSummary: {
      targetPath: contract.targetPath,
      requestedFidelity: contract.requestedFidelity,
      requestedScope: contract.requestedScope
    },
    status,
    surfaces: entries
  };
}

export function deriveSupervisorTruth(matrix) {
  return {
    supervisorStatus: matrix.status === 'all_complete' ? 'green' : 'red',
    stopAllowed: matrix.status === 'all_complete'
  };
}

export function saveMatrix(filePath, matrix) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(matrix, null, 2));
  return matrix;
}

export function loadMatrix(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
