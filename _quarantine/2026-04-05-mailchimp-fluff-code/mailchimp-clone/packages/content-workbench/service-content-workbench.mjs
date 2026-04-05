import { createContentWorkbenchWorkspace, summarizeContentWorkbenchWorkspace, createContentWorkbenchNarratives, createContentWorkbenchCoverageGrid } from './domain-content-workbench.mjs';
import { createContentWorkbenchPolicies, validateContentWorkbenchPolicies, summarizeContentWorkbenchPolicies, createContentWorkbenchEscalationDeck } from './policies-content-workbench.mjs';
import { createContentWorkbenchAnalyticsTimeline, createContentWorkbenchForecastEnvelope, createContentWorkbenchExceptionLedger, summarizeContentWorkbenchAnalytics } from './analytics-content-workbench.mjs';
import { createContentWorkbenchOperationsBoard, createContentWorkbenchShiftChecklist, createContentWorkbenchIncidentDeck } from './operations-content-workbench.mjs';
import { createContentWorkbenchReportCards, createContentWorkbenchReviewPackets, summarizeContentWorkbenchReporting } from './reporting-content-workbench.mjs';
import { createContentWorkbenchAuditTrail, createContentWorkbenchEvidenceManifest, createContentWorkbenchReadinessAttestation } from './audit-content-workbench.mjs';
import { createContentWorkbenchPlaybooks, createContentWorkbenchDecisionDeck, createContentWorkbenchEscalationMoments } from './playbooks-content-workbench.mjs';

export function buildContentWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentWorkbenchWorkspace(workspaceName);
  const policies = createContentWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeContentWorkbenchWorkspace(workspace),
    narratives: createContentWorkbenchNarratives(workspace),
    coverage: createContentWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentWorkbenchPolicies(policies),
    validation: validateContentWorkbenchPolicies(policies),
    escalationDeck: createContentWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createContentWorkbenchAnalyticsTimeline(),
      forecast: createContentWorkbenchForecastEnvelope(),
      exceptions: createContentWorkbenchExceptionLedger(),
      summary: summarizeContentWorkbenchAnalytics()
    },
    operations: {
      board: createContentWorkbenchOperationsBoard(),
      checklist: createContentWorkbenchShiftChecklist(),
      incidents: createContentWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createContentWorkbenchReportCards(),
      packets: createContentWorkbenchReviewPackets(),
      summary: summarizeContentWorkbenchReporting()
    },
    audit: {
      trail: createContentWorkbenchAuditTrail(),
      manifest: createContentWorkbenchEvidenceManifest(),
      attestation: createContentWorkbenchReadinessAttestation()
    },
    playbooks: createContentWorkbenchPlaybooks(),
    decisions: createContentWorkbenchDecisionDeck(),
    escalationMoments: createContentWorkbenchEscalationMoments()
  };
}

export function createContentWorkbenchReadinessBoard(snapshot = buildContentWorkbenchSnapshot()) {
  return [
    { id: 'content-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentWorkbenchApiDocument(snapshot = buildContentWorkbenchSnapshot()) {
  return {
    id: 'content-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-workbench/overview' },
      { method: 'GET', path: '/api/content-workbench/reporting' },
      { method: 'POST', path: '/api/content-workbench/validate' },
      { method: 'GET', path: '/api/content-workbench/audit' }
    ],
    readiness: createContentWorkbenchReadinessBoard(snapshot)
  };
}

export function createContentWorkbenchRouteSummary(snapshot = buildContentWorkbenchSnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

