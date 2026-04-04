import { createCustomerWorkbenchWorkspace, summarizeCustomerWorkbenchWorkspace, createCustomerWorkbenchNarratives, createCustomerWorkbenchCoverageGrid } from './domain-customer-workbench.mjs';
import { createCustomerWorkbenchPolicies, validateCustomerWorkbenchPolicies, summarizeCustomerWorkbenchPolicies, createCustomerWorkbenchEscalationDeck } from './policies-customer-workbench.mjs';
import { createCustomerWorkbenchAnalyticsTimeline, createCustomerWorkbenchForecastEnvelope, createCustomerWorkbenchExceptionLedger, summarizeCustomerWorkbenchAnalytics } from './analytics-customer-workbench.mjs';
import { createCustomerWorkbenchOperationsBoard, createCustomerWorkbenchShiftChecklist, createCustomerWorkbenchIncidentDeck } from './operations-customer-workbench.mjs';
import { createCustomerWorkbenchReportCards, createCustomerWorkbenchReviewPackets, summarizeCustomerWorkbenchReporting } from './reporting-customer-workbench.mjs';
import { createCustomerWorkbenchAuditTrail, createCustomerWorkbenchEvidenceManifest, createCustomerWorkbenchReadinessAttestation } from './audit-customer-workbench.mjs';
import { createCustomerWorkbenchPlaybooks, createCustomerWorkbenchDecisionDeck, createCustomerWorkbenchEscalationMoments } from './playbooks-customer-workbench.mjs';

export function buildCustomerWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerWorkbenchWorkspace(workspaceName);
  const policies = createCustomerWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeCustomerWorkbenchWorkspace(workspace),
    narratives: createCustomerWorkbenchNarratives(workspace),
    coverage: createCustomerWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerWorkbenchPolicies(policies),
    validation: validateCustomerWorkbenchPolicies(policies),
    escalationDeck: createCustomerWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createCustomerWorkbenchAnalyticsTimeline(),
      forecast: createCustomerWorkbenchForecastEnvelope(),
      exceptions: createCustomerWorkbenchExceptionLedger(),
      summary: summarizeCustomerWorkbenchAnalytics()
    },
    operations: {
      board: createCustomerWorkbenchOperationsBoard(),
      checklist: createCustomerWorkbenchShiftChecklist(),
      incidents: createCustomerWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createCustomerWorkbenchReportCards(),
      packets: createCustomerWorkbenchReviewPackets(),
      summary: summarizeCustomerWorkbenchReporting()
    },
    audit: {
      trail: createCustomerWorkbenchAuditTrail(),
      manifest: createCustomerWorkbenchEvidenceManifest(),
      attestation: createCustomerWorkbenchReadinessAttestation()
    },
    playbooks: createCustomerWorkbenchPlaybooks(),
    decisions: createCustomerWorkbenchDecisionDeck(),
    escalationMoments: createCustomerWorkbenchEscalationMoments()
  };
}

export function createCustomerWorkbenchReadinessBoard(snapshot = buildCustomerWorkbenchSnapshot()) {
  return [
    { id: 'customer-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerWorkbenchApiDocument(snapshot = buildCustomerWorkbenchSnapshot()) {
  return {
    id: 'customer-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-workbench/overview' },
      { method: 'GET', path: '/api/customer-workbench/reporting' },
      { method: 'POST', path: '/api/customer-workbench/validate' },
      { method: 'GET', path: '/api/customer-workbench/audit' }
    ],
    readiness: createCustomerWorkbenchReadinessBoard(snapshot)
  };
}

export function createCustomerWorkbenchRouteSummary(snapshot = buildCustomerWorkbenchSnapshot()) {
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

