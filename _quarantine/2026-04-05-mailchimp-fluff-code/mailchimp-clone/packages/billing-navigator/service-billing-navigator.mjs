import { createBillingNavigatorWorkspace, summarizeBillingNavigatorWorkspace, createBillingNavigatorNarratives, createBillingNavigatorCoverageGrid } from './domain-billing-navigator.mjs';
import { createBillingNavigatorPolicies, validateBillingNavigatorPolicies, summarizeBillingNavigatorPolicies, createBillingNavigatorEscalationDeck } from './policies-billing-navigator.mjs';
import { createBillingNavigatorAnalyticsTimeline, createBillingNavigatorForecastEnvelope, createBillingNavigatorExceptionLedger, summarizeBillingNavigatorAnalytics } from './analytics-billing-navigator.mjs';
import { createBillingNavigatorOperationsBoard, createBillingNavigatorShiftChecklist, createBillingNavigatorIncidentDeck } from './operations-billing-navigator.mjs';
import { createBillingNavigatorReportCards, createBillingNavigatorReviewPackets, summarizeBillingNavigatorReporting } from './reporting-billing-navigator.mjs';
import { createBillingNavigatorAuditTrail, createBillingNavigatorEvidenceManifest, createBillingNavigatorReadinessAttestation } from './audit-billing-navigator.mjs';
import { createBillingNavigatorPlaybooks, createBillingNavigatorDecisionDeck, createBillingNavigatorEscalationMoments } from './playbooks-billing-navigator.mjs';

export function buildBillingNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingNavigatorWorkspace(workspaceName);
  const policies = createBillingNavigatorPolicies();
  return {
    workspace,
    summary: summarizeBillingNavigatorWorkspace(workspace),
    narratives: createBillingNavigatorNarratives(workspace),
    coverage: createBillingNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingNavigatorPolicies(policies),
    validation: validateBillingNavigatorPolicies(policies),
    escalationDeck: createBillingNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createBillingNavigatorAnalyticsTimeline(),
      forecast: createBillingNavigatorForecastEnvelope(),
      exceptions: createBillingNavigatorExceptionLedger(),
      summary: summarizeBillingNavigatorAnalytics()
    },
    operations: {
      board: createBillingNavigatorOperationsBoard(),
      checklist: createBillingNavigatorShiftChecklist(),
      incidents: createBillingNavigatorIncidentDeck()
    },
    reporting: {
      cards: createBillingNavigatorReportCards(),
      packets: createBillingNavigatorReviewPackets(),
      summary: summarizeBillingNavigatorReporting()
    },
    audit: {
      trail: createBillingNavigatorAuditTrail(),
      manifest: createBillingNavigatorEvidenceManifest(),
      attestation: createBillingNavigatorReadinessAttestation()
    },
    playbooks: createBillingNavigatorPlaybooks(),
    decisions: createBillingNavigatorDecisionDeck(),
    escalationMoments: createBillingNavigatorEscalationMoments()
  };
}

export function createBillingNavigatorReadinessBoard(snapshot = buildBillingNavigatorSnapshot()) {
  return [
    { id: 'billing-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingNavigatorApiDocument(snapshot = buildBillingNavigatorSnapshot()) {
  return {
    id: 'billing-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-navigator/overview' },
      { method: 'GET', path: '/api/billing-navigator/reporting' },
      { method: 'POST', path: '/api/billing-navigator/validate' },
      { method: 'GET', path: '/api/billing-navigator/audit' }
    ],
    readiness: createBillingNavigatorReadinessBoard(snapshot)
  };
}

export function createBillingNavigatorRouteSummary(snapshot = buildBillingNavigatorSnapshot()) {
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

