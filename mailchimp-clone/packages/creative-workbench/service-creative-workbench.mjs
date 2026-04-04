import { createCreativeWorkbenchWorkspace, summarizeCreativeWorkbenchWorkspace, createCreativeWorkbenchNarratives, createCreativeWorkbenchCoverageGrid } from './domain-creative-workbench.mjs';
import { createCreativeWorkbenchPolicies, validateCreativeWorkbenchPolicies, summarizeCreativeWorkbenchPolicies, createCreativeWorkbenchEscalationDeck } from './policies-creative-workbench.mjs';
import { createCreativeWorkbenchAnalyticsTimeline, createCreativeWorkbenchForecastEnvelope, createCreativeWorkbenchExceptionLedger, summarizeCreativeWorkbenchAnalytics } from './analytics-creative-workbench.mjs';
import { createCreativeWorkbenchOperationsBoard, createCreativeWorkbenchShiftChecklist, createCreativeWorkbenchIncidentDeck } from './operations-creative-workbench.mjs';
import { createCreativeWorkbenchReportCards, createCreativeWorkbenchReviewPackets, summarizeCreativeWorkbenchReporting } from './reporting-creative-workbench.mjs';
import { createCreativeWorkbenchAuditTrail, createCreativeWorkbenchEvidenceManifest, createCreativeWorkbenchReadinessAttestation } from './audit-creative-workbench.mjs';
import { createCreativeWorkbenchPlaybooks, createCreativeWorkbenchDecisionDeck, createCreativeWorkbenchEscalationMoments } from './playbooks-creative-workbench.mjs';

export function buildCreativeWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeWorkbenchWorkspace(workspaceName);
  const policies = createCreativeWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeCreativeWorkbenchWorkspace(workspace),
    narratives: createCreativeWorkbenchNarratives(workspace),
    coverage: createCreativeWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeWorkbenchPolicies(policies),
    validation: validateCreativeWorkbenchPolicies(policies),
    escalationDeck: createCreativeWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createCreativeWorkbenchAnalyticsTimeline(),
      forecast: createCreativeWorkbenchForecastEnvelope(),
      exceptions: createCreativeWorkbenchExceptionLedger(),
      summary: summarizeCreativeWorkbenchAnalytics()
    },
    operations: {
      board: createCreativeWorkbenchOperationsBoard(),
      checklist: createCreativeWorkbenchShiftChecklist(),
      incidents: createCreativeWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createCreativeWorkbenchReportCards(),
      packets: createCreativeWorkbenchReviewPackets(),
      summary: summarizeCreativeWorkbenchReporting()
    },
    audit: {
      trail: createCreativeWorkbenchAuditTrail(),
      manifest: createCreativeWorkbenchEvidenceManifest(),
      attestation: createCreativeWorkbenchReadinessAttestation()
    },
    playbooks: createCreativeWorkbenchPlaybooks(),
    decisions: createCreativeWorkbenchDecisionDeck(),
    escalationMoments: createCreativeWorkbenchEscalationMoments()
  };
}

export function createCreativeWorkbenchReadinessBoard(snapshot = buildCreativeWorkbenchSnapshot()) {
  return [
    { id: 'creative-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeWorkbenchApiDocument(snapshot = buildCreativeWorkbenchSnapshot()) {
  return {
    id: 'creative-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-workbench/overview' },
      { method: 'GET', path: '/api/creative-workbench/reporting' },
      { method: 'POST', path: '/api/creative-workbench/validate' },
      { method: 'GET', path: '/api/creative-workbench/audit' }
    ],
    readiness: createCreativeWorkbenchReadinessBoard(snapshot)
  };
}

export function createCreativeWorkbenchRouteSummary(snapshot = buildCreativeWorkbenchSnapshot()) {
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

