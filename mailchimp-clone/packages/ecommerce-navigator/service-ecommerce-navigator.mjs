import { createEcommerceNavigatorWorkspace, summarizeEcommerceNavigatorWorkspace, createEcommerceNavigatorNarratives, createEcommerceNavigatorCoverageGrid } from './domain-ecommerce-navigator.mjs';
import { createEcommerceNavigatorPolicies, validateEcommerceNavigatorPolicies, summarizeEcommerceNavigatorPolicies, createEcommerceNavigatorEscalationDeck } from './policies-ecommerce-navigator.mjs';
import { createEcommerceNavigatorAnalyticsTimeline, createEcommerceNavigatorForecastEnvelope, createEcommerceNavigatorExceptionLedger, summarizeEcommerceNavigatorAnalytics } from './analytics-ecommerce-navigator.mjs';
import { createEcommerceNavigatorOperationsBoard, createEcommerceNavigatorShiftChecklist, createEcommerceNavigatorIncidentDeck } from './operations-ecommerce-navigator.mjs';
import { createEcommerceNavigatorReportCards, createEcommerceNavigatorReviewPackets, summarizeEcommerceNavigatorReporting } from './reporting-ecommerce-navigator.mjs';
import { createEcommerceNavigatorAuditTrail, createEcommerceNavigatorEvidenceManifest, createEcommerceNavigatorReadinessAttestation } from './audit-ecommerce-navigator.mjs';
import { createEcommerceNavigatorPlaybooks, createEcommerceNavigatorDecisionDeck, createEcommerceNavigatorEscalationMoments } from './playbooks-ecommerce-navigator.mjs';

export function buildEcommerceNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceNavigatorWorkspace(workspaceName);
  const policies = createEcommerceNavigatorPolicies();
  return {
    workspace,
    summary: summarizeEcommerceNavigatorWorkspace(workspace),
    narratives: createEcommerceNavigatorNarratives(workspace),
    coverage: createEcommerceNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceNavigatorPolicies(policies),
    validation: validateEcommerceNavigatorPolicies(policies),
    escalationDeck: createEcommerceNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceNavigatorAnalyticsTimeline(),
      forecast: createEcommerceNavigatorForecastEnvelope(),
      exceptions: createEcommerceNavigatorExceptionLedger(),
      summary: summarizeEcommerceNavigatorAnalytics()
    },
    operations: {
      board: createEcommerceNavigatorOperationsBoard(),
      checklist: createEcommerceNavigatorShiftChecklist(),
      incidents: createEcommerceNavigatorIncidentDeck()
    },
    reporting: {
      cards: createEcommerceNavigatorReportCards(),
      packets: createEcommerceNavigatorReviewPackets(),
      summary: summarizeEcommerceNavigatorReporting()
    },
    audit: {
      trail: createEcommerceNavigatorAuditTrail(),
      manifest: createEcommerceNavigatorEvidenceManifest(),
      attestation: createEcommerceNavigatorReadinessAttestation()
    },
    playbooks: createEcommerceNavigatorPlaybooks(),
    decisions: createEcommerceNavigatorDecisionDeck(),
    escalationMoments: createEcommerceNavigatorEscalationMoments()
  };
}

export function createEcommerceNavigatorReadinessBoard(snapshot = buildEcommerceNavigatorSnapshot()) {
  return [
    { id: 'ecommerce-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceNavigatorApiDocument(snapshot = buildEcommerceNavigatorSnapshot()) {
  return {
    id: 'ecommerce-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-navigator/overview' },
      { method: 'GET', path: '/api/ecommerce-navigator/reporting' },
      { method: 'POST', path: '/api/ecommerce-navigator/validate' },
      { method: 'GET', path: '/api/ecommerce-navigator/audit' }
    ],
    readiness: createEcommerceNavigatorReadinessBoard(snapshot)
  };
}

export function createEcommerceNavigatorRouteSummary(snapshot = buildEcommerceNavigatorSnapshot()) {
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

