import fs from 'node:fs';
import path from 'node:path';

export const ISSUE_STATUSES = ['pending', 'in_progress', 'complete', 'blocked'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniq(list) {
  return [...new Set((list || []).filter(Boolean))];
}

export function createIssueGraph(meta = {}) {
  return {
    version: 1,
    meta: {
      title: meta.title || 'issue-dag',
      createdAt: meta.createdAt || new Date().toISOString(),
      targetPath: meta.targetPath || null
    },
    issues: []
  };
}

export function normalizeIssue(issue) {
  if (!issue?.id) throw new Error('issue.id is required');
  const status = issue.status || 'pending';
  if (!ISSUE_STATUSES.includes(status)) throw new Error(`invalid issue status ${status}`);
  return {
    id: issue.id,
    title: issue.title || issue.id,
    lane: issue.lane || 'default',
    owner: issue.owner || 'unassigned',
    deps: uniq(issue.deps),
    parentId: issue.parentId || null,
    children: uniq(issue.children),
    acceptanceCriteria: Array.isArray(issue.acceptanceCriteria) ? issue.acceptanceCriteria : [issue.acceptanceCriteria || ''],
    status,
    artifacts: uniq(issue.artifacts),
    notes: issue.notes || ''
  };
}

export function upsertIssue(graph, issue) {
  const next = clone(graph);
  const normalized = normalizeIssue(issue);
  const index = next.issues.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) next.issues[index] = { ...next.issues[index], ...normalized };
  else next.issues.push(normalized);
  return next;
}

export function getIssue(graph, issueId) {
  return graph.issues.find((entry) => entry.id === issueId) || null;
}

export function linkDependency(graph, issueId, depId) {
  const issue = getIssue(graph, issueId);
  if (!issue) throw new Error(`missing issue ${issueId}`);
  const next = upsertIssue(graph, { ...issue, deps: uniq([...(issue.deps || []), depId]) });
  const dep = getIssue(next, depId);
  if (!dep) return next;
  return upsertIssue(next, { ...dep, children: uniq([...(dep.children || []), issueId]) });
}

export function setIssueStatus(graph, issueId, status, artifacts = []) {
  if (!ISSUE_STATUSES.includes(status)) throw new Error(`invalid issue status ${status}`);
  const issue = getIssue(graph, issueId);
  if (!issue) throw new Error(`missing issue ${issueId}`);
  return upsertIssue(graph, {
    ...issue,
    status,
    artifacts: uniq([...(issue.artifacts || []), ...artifacts])
  });
}

export function readyIssues(graph) {
  return graph.issues.filter((issue) => issue.status !== 'complete' && issue.status !== 'blocked' && issue.deps.every((depId) => getIssue(graph, depId)?.status === 'complete'));
}

export function summarizeGraph(graph) {
  const counts = Object.fromEntries(ISSUE_STATUSES.map((status) => [status, 0]));
  for (const issue of graph.issues) counts[issue.status] += 1;
  const lanes = {};
  for (const issue of graph.issues) {
    lanes[issue.lane] ||= { total: 0, complete: 0, blocked: 0 };
    lanes[issue.lane].total += 1;
    if (issue.status === 'complete') lanes[issue.lane].complete += 1;
    if (issue.status === 'blocked') lanes[issue.lane].blocked += 1;
  }
  return {
    title: graph.meta?.title || 'issue-dag',
    counts,
    lanes,
    ready: readyIssues(graph).map((issue) => issue.id)
  };
}

export function saveGraph(filePath, graph) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(graph, null, 2));
  return graph;
}

export function loadGraph(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
