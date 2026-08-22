import test from 'node:test';
import assert from 'node:assert/strict';
import { createIssueGraph, upsertIssue, linkDependency, readyIssues, setIssueStatus, summarizeGraph } from '../packages/issue-dag/index.mjs';

test('persists issue dag semantics with ready queue and parent-child deps', () => {
  let graph = createIssueGraph({ title: 'demo' });
  graph = upsertIssue(graph, { id: 'a', title: 'A', lane: 'lane-a', owner: 'alice', acceptanceCriteria: ['done'] });
  graph = upsertIssue(graph, { id: 'b', title: 'B', lane: 'lane-b', owner: 'bob', acceptanceCriteria: ['done'] });
  graph = linkDependency(graph, 'b', 'a');
  assert.deepEqual(readyIssues(graph).map((issue) => issue.id), ['a']);
  graph = setIssueStatus(graph, 'a', 'complete');
  assert.deepEqual(readyIssues(graph).map((issue) => issue.id), ['b']);
  const summary = summarizeGraph(graph);
  assert.equal(summary.counts.complete, 1);
  assert.equal(summary.lanes['lane-a'].complete, 1);
});
