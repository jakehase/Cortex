import { createCommerceNavigatorWorkspace, summarizeCommerceNavigatorWorkspace, createCommerceNavigatorNarratives, createCommerceNavigatorCoverageGrid } from './domain-commerce-navigator.mjs';
import { createCommerceNavigatorPolicies, validateCommerceNavigatorPolicies, summarizeCommerceNavigatorPolicies, createCommerceNavigatorEscalationDeck } from './policies-commerce-navigator.mjs';
import { createCommerceNavigatorAnalyticsTimeline, createCommerceNavigatorForecastEnvelope, createCommerceNavigatorExceptionLedger, summarizeCommerceNavigatorAnalytics } from './analytics-commerce-navigator.mjs';
import { createCommerceNavigatorOperationsBoard, createCommerceNavigatorShiftChecklist, createCommerceNavigatorIncidentDeck } from './operations-commerce-navigator.mjs';
import { createCommerceNavigatorReportCards, createCommerceNavigatorReviewPackets, summarizeCommerceNavigatorReporting } from './reporting-commerce-navigator.mjs';
import { createCommerceNavigatorAuditTrail, createCommerceNavigatorEvidenceManifest, createCommerceNavigatorReadinessAttestation } from './audit-commerce-navigator.mjs';
import { createCommerceNavigatorPlaybooks, createCommerceNavigatorDecisionDeck, createCommerceNavigatorEscalationMoments } from './playbooks-commerce-navigator.mjs';

export function buildCommerceNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceNavigatorWorkspace(workspaceName);
  const policies = createCommerceNavigatorPolicies();
  return {
    workspace,
    summary: summarizeCommerceNavigatorWorkspace(workspace),
    narratives: createCommerceNavigatorNarratives(workspace),
    coverage: createCommerceNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceNavigatorPolicies(policies),
    validation: validateCommerceNavigatorPolicies(policies),
    escalationDeck: createCommerceNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createCommerceNavigatorAnalyticsTimeline(),
      forecast: createCommerceNavigatorForecastEnvelope(),
      exceptions: createCommerceNavigatorExceptionLedger(),
      summary: summarizeCommerceNavigatorAnalytics()
    },
    operations: {
      board: createCommerceNavigatorOperationsBoard(),
      checklist: createCommerceNavigatorShiftChecklist(),
      incidents: createCommerceNavigatorIncidentDeck()
    },
    reporting: {
      cards: createCommerceNavigatorReportCards(),
      packets: createCommerceNavigatorReviewPackets(),
      summary: summarizeCommerceNavigatorReporting()
    },
    audit: {
      trail: createCommerceNavigatorAuditTrail(),
      manifest: createCommerceNavigatorEvidenceManifest(),
      attestation: createCommerceNavigatorReadinessAttestation()
    },
    playbooks: createCommerceNavigatorPlaybooks(),
    decisions: createCommerceNavigatorDecisionDeck(),
    escalationMoments: createCommerceNavigatorEscalationMoments()
  };
}

export function createCommerceNavigatorReadinessBoard(snapshot = buildCommerceNavigatorSnapshot()) {
  return [
    { id: 'commerce-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceNavigatorApiDocument(snapshot = buildCommerceNavigatorSnapshot()) {
  return {
    id: 'commerce-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-navigator/overview' },
      { method: 'GET', path: '/api/commerce-navigator/reporting' },
      { method: 'POST', path: '/api/commerce-navigator/validate' },
      { method: 'GET', path: '/api/commerce-navigator/audit' }
    ],
    readiness: createCommerceNavigatorReadinessBoard(snapshot)
  };
}

export function createCommerceNavigatorRouteSummary(snapshot = buildCommerceNavigatorSnapshot()) {
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

