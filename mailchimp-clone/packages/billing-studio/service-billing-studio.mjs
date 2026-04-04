import { createBillingStudioWorkspace, summarizeBillingStudioWorkspace, createBillingStudioNarratives, createBillingStudioCoverageGrid } from './domain-billing-studio.mjs';
import { createBillingStudioPolicies, validateBillingStudioPolicies, summarizeBillingStudioPolicies, createBillingStudioEscalationDeck } from './policies-billing-studio.mjs';
import { createBillingStudioAnalyticsTimeline, createBillingStudioForecastEnvelope, createBillingStudioExceptionLedger, summarizeBillingStudioAnalytics } from './analytics-billing-studio.mjs';
import { createBillingStudioOperationsBoard, createBillingStudioShiftChecklist, createBillingStudioIncidentDeck } from './operations-billing-studio.mjs';
import { createBillingStudioReportCards, createBillingStudioReviewPackets, summarizeBillingStudioReporting } from './reporting-billing-studio.mjs';
import { createBillingStudioAuditTrail, createBillingStudioEvidenceManifest, createBillingStudioReadinessAttestation } from './audit-billing-studio.mjs';
import { createBillingStudioPlaybooks, createBillingStudioDecisionDeck, createBillingStudioEscalationMoments } from './playbooks-billing-studio.mjs';

export function buildBillingStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingStudioWorkspace(workspaceName);
  const policies = createBillingStudioPolicies();
  return {
    workspace,
    summary: summarizeBillingStudioWorkspace(workspace),
    narratives: createBillingStudioNarratives(workspace),
    coverage: createBillingStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingStudioPolicies(policies),
    validation: validateBillingStudioPolicies(policies),
    escalationDeck: createBillingStudioEscalationDeck(policies),
    analytics: {
      timeline: createBillingStudioAnalyticsTimeline(),
      forecast: createBillingStudioForecastEnvelope(),
      exceptions: createBillingStudioExceptionLedger(),
      summary: summarizeBillingStudioAnalytics()
    },
    operations: {
      board: createBillingStudioOperationsBoard(),
      checklist: createBillingStudioShiftChecklist(),
      incidents: createBillingStudioIncidentDeck()
    },
    reporting: {
      cards: createBillingStudioReportCards(),
      packets: createBillingStudioReviewPackets(),
      summary: summarizeBillingStudioReporting()
    },
    audit: {
      trail: createBillingStudioAuditTrail(),
      manifest: createBillingStudioEvidenceManifest(),
      attestation: createBillingStudioReadinessAttestation()
    },
    playbooks: createBillingStudioPlaybooks(),
    decisions: createBillingStudioDecisionDeck(),
    escalationMoments: createBillingStudioEscalationMoments()
  };
}

export function createBillingStudioReadinessBoard(snapshot = buildBillingStudioSnapshot()) {
  return [
    { id: 'billing-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingStudioApiDocument(snapshot = buildBillingStudioSnapshot()) {
  return {
    id: 'billing-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-studio/overview' },
      { method: 'GET', path: '/api/billing-studio/reporting' },
      { method: 'POST', path: '/api/billing-studio/validate' },
      { method: 'GET', path: '/api/billing-studio/audit' }
    ],
    readiness: createBillingStudioReadinessBoard(snapshot)
  };
}

export function createBillingStudioRouteSummary(snapshot = buildBillingStudioSnapshot()) {
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

