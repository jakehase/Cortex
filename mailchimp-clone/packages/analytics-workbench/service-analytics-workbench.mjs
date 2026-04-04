import { createAnalyticsWorkbenchWorkspace, summarizeAnalyticsWorkbenchWorkspace, createAnalyticsWorkbenchNarratives, createAnalyticsWorkbenchCoverageGrid } from './domain-analytics-workbench.mjs';
import { createAnalyticsWorkbenchPolicies, validateAnalyticsWorkbenchPolicies, summarizeAnalyticsWorkbenchPolicies, createAnalyticsWorkbenchEscalationDeck } from './policies-analytics-workbench.mjs';
import { createAnalyticsWorkbenchAnalyticsTimeline, createAnalyticsWorkbenchForecastEnvelope, createAnalyticsWorkbenchExceptionLedger, summarizeAnalyticsWorkbenchAnalytics } from './analytics-analytics-workbench.mjs';
import { createAnalyticsWorkbenchOperationsBoard, createAnalyticsWorkbenchShiftChecklist, createAnalyticsWorkbenchIncidentDeck } from './operations-analytics-workbench.mjs';
import { createAnalyticsWorkbenchReportCards, createAnalyticsWorkbenchReviewPackets, summarizeAnalyticsWorkbenchReporting } from './reporting-analytics-workbench.mjs';
import { createAnalyticsWorkbenchAuditTrail, createAnalyticsWorkbenchEvidenceManifest, createAnalyticsWorkbenchReadinessAttestation } from './audit-analytics-workbench.mjs';
import { createAnalyticsWorkbenchPlaybooks, createAnalyticsWorkbenchDecisionDeck, createAnalyticsWorkbenchEscalationMoments } from './playbooks-analytics-workbench.mjs';

export function buildAnalyticsWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsWorkbenchWorkspace(workspaceName);
  const policies = createAnalyticsWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsWorkbenchWorkspace(workspace),
    narratives: createAnalyticsWorkbenchNarratives(workspace),
    coverage: createAnalyticsWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsWorkbenchPolicies(policies),
    validation: validateAnalyticsWorkbenchPolicies(policies),
    escalationDeck: createAnalyticsWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsWorkbenchAnalyticsTimeline(),
      forecast: createAnalyticsWorkbenchForecastEnvelope(),
      exceptions: createAnalyticsWorkbenchExceptionLedger(),
      summary: summarizeAnalyticsWorkbenchAnalytics()
    },
    operations: {
      board: createAnalyticsWorkbenchOperationsBoard(),
      checklist: createAnalyticsWorkbenchShiftChecklist(),
      incidents: createAnalyticsWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsWorkbenchReportCards(),
      packets: createAnalyticsWorkbenchReviewPackets(),
      summary: summarizeAnalyticsWorkbenchReporting()
    },
    audit: {
      trail: createAnalyticsWorkbenchAuditTrail(),
      manifest: createAnalyticsWorkbenchEvidenceManifest(),
      attestation: createAnalyticsWorkbenchReadinessAttestation()
    },
    playbooks: createAnalyticsWorkbenchPlaybooks(),
    decisions: createAnalyticsWorkbenchDecisionDeck(),
    escalationMoments: createAnalyticsWorkbenchEscalationMoments()
  };
}

export function createAnalyticsWorkbenchReadinessBoard(snapshot = buildAnalyticsWorkbenchSnapshot()) {
  return [
    { id: 'analytics-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsWorkbenchApiDocument(snapshot = buildAnalyticsWorkbenchSnapshot()) {
  return {
    id: 'analytics-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-workbench/overview' },
      { method: 'GET', path: '/api/analytics-workbench/reporting' },
      { method: 'POST', path: '/api/analytics-workbench/validate' },
      { method: 'GET', path: '/api/analytics-workbench/audit' }
    ],
    readiness: createAnalyticsWorkbenchReadinessBoard(snapshot)
  };
}

export function createAnalyticsWorkbenchRouteSummary(snapshot = buildAnalyticsWorkbenchSnapshot()) {
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

