import { createCustomerNavigatorWorkspace, summarizeCustomerNavigatorWorkspace, createCustomerNavigatorNarratives, createCustomerNavigatorCoverageGrid } from './domain-customer-navigator.mjs';
import { createCustomerNavigatorPolicies, validateCustomerNavigatorPolicies, summarizeCustomerNavigatorPolicies, createCustomerNavigatorEscalationDeck } from './policies-customer-navigator.mjs';
import { createCustomerNavigatorAnalyticsTimeline, createCustomerNavigatorForecastEnvelope, createCustomerNavigatorExceptionLedger, summarizeCustomerNavigatorAnalytics } from './analytics-customer-navigator.mjs';
import { createCustomerNavigatorOperationsBoard, createCustomerNavigatorShiftChecklist, createCustomerNavigatorIncidentDeck } from './operations-customer-navigator.mjs';
import { createCustomerNavigatorReportCards, createCustomerNavigatorReviewPackets, summarizeCustomerNavigatorReporting } from './reporting-customer-navigator.mjs';
import { createCustomerNavigatorAuditTrail, createCustomerNavigatorEvidenceManifest, createCustomerNavigatorReadinessAttestation } from './audit-customer-navigator.mjs';
import { createCustomerNavigatorPlaybooks, createCustomerNavigatorDecisionDeck, createCustomerNavigatorEscalationMoments } from './playbooks-customer-navigator.mjs';

export function buildCustomerNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerNavigatorWorkspace(workspaceName);
  const policies = createCustomerNavigatorPolicies();
  return {
    workspace,
    summary: summarizeCustomerNavigatorWorkspace(workspace),
    narratives: createCustomerNavigatorNarratives(workspace),
    coverage: createCustomerNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerNavigatorPolicies(policies),
    validation: validateCustomerNavigatorPolicies(policies),
    escalationDeck: createCustomerNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createCustomerNavigatorAnalyticsTimeline(),
      forecast: createCustomerNavigatorForecastEnvelope(),
      exceptions: createCustomerNavigatorExceptionLedger(),
      summary: summarizeCustomerNavigatorAnalytics()
    },
    operations: {
      board: createCustomerNavigatorOperationsBoard(),
      checklist: createCustomerNavigatorShiftChecklist(),
      incidents: createCustomerNavigatorIncidentDeck()
    },
    reporting: {
      cards: createCustomerNavigatorReportCards(),
      packets: createCustomerNavigatorReviewPackets(),
      summary: summarizeCustomerNavigatorReporting()
    },
    audit: {
      trail: createCustomerNavigatorAuditTrail(),
      manifest: createCustomerNavigatorEvidenceManifest(),
      attestation: createCustomerNavigatorReadinessAttestation()
    },
    playbooks: createCustomerNavigatorPlaybooks(),
    decisions: createCustomerNavigatorDecisionDeck(),
    escalationMoments: createCustomerNavigatorEscalationMoments()
  };
}

export function createCustomerNavigatorReadinessBoard(snapshot = buildCustomerNavigatorSnapshot()) {
  return [
    { id: 'customer-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerNavigatorApiDocument(snapshot = buildCustomerNavigatorSnapshot()) {
  return {
    id: 'customer-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-navigator/overview' },
      { method: 'GET', path: '/api/customer-navigator/reporting' },
      { method: 'POST', path: '/api/customer-navigator/validate' },
      { method: 'GET', path: '/api/customer-navigator/audit' }
    ],
    readiness: createCustomerNavigatorReadinessBoard(snapshot)
  };
}

export function createCustomerNavigatorRouteSummary(snapshot = buildCustomerNavigatorSnapshot()) {
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

