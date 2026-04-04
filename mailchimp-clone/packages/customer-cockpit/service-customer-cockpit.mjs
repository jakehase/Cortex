import { createCustomerCockpitWorkspace, summarizeCustomerCockpitWorkspace, createCustomerCockpitNarratives, createCustomerCockpitCoverageGrid } from './domain-customer-cockpit.mjs';
import { createCustomerCockpitPolicies, validateCustomerCockpitPolicies, summarizeCustomerCockpitPolicies, createCustomerCockpitEscalationDeck } from './policies-customer-cockpit.mjs';
import { createCustomerCockpitAnalyticsTimeline, createCustomerCockpitForecastEnvelope, createCustomerCockpitExceptionLedger, summarizeCustomerCockpitAnalytics } from './analytics-customer-cockpit.mjs';
import { createCustomerCockpitOperationsBoard, createCustomerCockpitShiftChecklist, createCustomerCockpitIncidentDeck } from './operations-customer-cockpit.mjs';
import { createCustomerCockpitReportCards, createCustomerCockpitReviewPackets, summarizeCustomerCockpitReporting } from './reporting-customer-cockpit.mjs';
import { createCustomerCockpitAuditTrail, createCustomerCockpitEvidenceManifest, createCustomerCockpitReadinessAttestation } from './audit-customer-cockpit.mjs';
import { createCustomerCockpitPlaybooks, createCustomerCockpitDecisionDeck, createCustomerCockpitEscalationMoments } from './playbooks-customer-cockpit.mjs';

export function buildCustomerCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerCockpitWorkspace(workspaceName);
  const policies = createCustomerCockpitPolicies();
  return {
    workspace,
    summary: summarizeCustomerCockpitWorkspace(workspace),
    narratives: createCustomerCockpitNarratives(workspace),
    coverage: createCustomerCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerCockpitPolicies(policies),
    validation: validateCustomerCockpitPolicies(policies),
    escalationDeck: createCustomerCockpitEscalationDeck(policies),
    analytics: {
      timeline: createCustomerCockpitAnalyticsTimeline(),
      forecast: createCustomerCockpitForecastEnvelope(),
      exceptions: createCustomerCockpitExceptionLedger(),
      summary: summarizeCustomerCockpitAnalytics()
    },
    operations: {
      board: createCustomerCockpitOperationsBoard(),
      checklist: createCustomerCockpitShiftChecklist(),
      incidents: createCustomerCockpitIncidentDeck()
    },
    reporting: {
      cards: createCustomerCockpitReportCards(),
      packets: createCustomerCockpitReviewPackets(),
      summary: summarizeCustomerCockpitReporting()
    },
    audit: {
      trail: createCustomerCockpitAuditTrail(),
      manifest: createCustomerCockpitEvidenceManifest(),
      attestation: createCustomerCockpitReadinessAttestation()
    },
    playbooks: createCustomerCockpitPlaybooks(),
    decisions: createCustomerCockpitDecisionDeck(),
    escalationMoments: createCustomerCockpitEscalationMoments()
  };
}

export function createCustomerCockpitReadinessBoard(snapshot = buildCustomerCockpitSnapshot()) {
  return [
    { id: 'customer-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerCockpitApiDocument(snapshot = buildCustomerCockpitSnapshot()) {
  return {
    id: 'customer-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-cockpit/overview' },
      { method: 'GET', path: '/api/customer-cockpit/reporting' },
      { method: 'POST', path: '/api/customer-cockpit/validate' },
      { method: 'GET', path: '/api/customer-cockpit/audit' }
    ],
    readiness: createCustomerCockpitReadinessBoard(snapshot)
  };
}

export function createCustomerCockpitRouteSummary(snapshot = buildCustomerCockpitSnapshot()) {
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

