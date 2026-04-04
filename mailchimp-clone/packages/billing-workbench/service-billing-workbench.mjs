import { createBillingWorkbenchWorkspace, summarizeBillingWorkbenchWorkspace, createBillingWorkbenchNarratives, createBillingWorkbenchCoverageGrid } from './domain-billing-workbench.mjs';
import { createBillingWorkbenchPolicies, validateBillingWorkbenchPolicies, summarizeBillingWorkbenchPolicies, createBillingWorkbenchEscalationDeck } from './policies-billing-workbench.mjs';
import { createBillingWorkbenchAnalyticsTimeline, createBillingWorkbenchForecastEnvelope, createBillingWorkbenchExceptionLedger, summarizeBillingWorkbenchAnalytics } from './analytics-billing-workbench.mjs';
import { createBillingWorkbenchOperationsBoard, createBillingWorkbenchShiftChecklist, createBillingWorkbenchIncidentDeck } from './operations-billing-workbench.mjs';
import { createBillingWorkbenchReportCards, createBillingWorkbenchReviewPackets, summarizeBillingWorkbenchReporting } from './reporting-billing-workbench.mjs';
import { createBillingWorkbenchAuditTrail, createBillingWorkbenchEvidenceManifest, createBillingWorkbenchReadinessAttestation } from './audit-billing-workbench.mjs';
import { createBillingWorkbenchPlaybooks, createBillingWorkbenchDecisionDeck, createBillingWorkbenchEscalationMoments } from './playbooks-billing-workbench.mjs';

export function buildBillingWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingWorkbenchWorkspace(workspaceName);
  const policies = createBillingWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeBillingWorkbenchWorkspace(workspace),
    narratives: createBillingWorkbenchNarratives(workspace),
    coverage: createBillingWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingWorkbenchPolicies(policies),
    validation: validateBillingWorkbenchPolicies(policies),
    escalationDeck: createBillingWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createBillingWorkbenchAnalyticsTimeline(),
      forecast: createBillingWorkbenchForecastEnvelope(),
      exceptions: createBillingWorkbenchExceptionLedger(),
      summary: summarizeBillingWorkbenchAnalytics()
    },
    operations: {
      board: createBillingWorkbenchOperationsBoard(),
      checklist: createBillingWorkbenchShiftChecklist(),
      incidents: createBillingWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createBillingWorkbenchReportCards(),
      packets: createBillingWorkbenchReviewPackets(),
      summary: summarizeBillingWorkbenchReporting()
    },
    audit: {
      trail: createBillingWorkbenchAuditTrail(),
      manifest: createBillingWorkbenchEvidenceManifest(),
      attestation: createBillingWorkbenchReadinessAttestation()
    },
    playbooks: createBillingWorkbenchPlaybooks(),
    decisions: createBillingWorkbenchDecisionDeck(),
    escalationMoments: createBillingWorkbenchEscalationMoments()
  };
}

export function createBillingWorkbenchReadinessBoard(snapshot = buildBillingWorkbenchSnapshot()) {
  return [
    { id: 'billing-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingWorkbenchApiDocument(snapshot = buildBillingWorkbenchSnapshot()) {
  return {
    id: 'billing-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-workbench/overview' },
      { method: 'GET', path: '/api/billing-workbench/reporting' },
      { method: 'POST', path: '/api/billing-workbench/validate' },
      { method: 'GET', path: '/api/billing-workbench/audit' }
    ],
    readiness: createBillingWorkbenchReadinessBoard(snapshot)
  };
}

export function createBillingWorkbenchRouteSummary(snapshot = buildBillingWorkbenchSnapshot()) {
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

