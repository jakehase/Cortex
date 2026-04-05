import { createCustomerStudioWorkspace, summarizeCustomerStudioWorkspace, createCustomerStudioNarratives, createCustomerStudioCoverageGrid } from './domain-customer-studio.mjs';
import { createCustomerStudioPolicies, validateCustomerStudioPolicies, summarizeCustomerStudioPolicies, createCustomerStudioEscalationDeck } from './policies-customer-studio.mjs';
import { createCustomerStudioAnalyticsTimeline, createCustomerStudioForecastEnvelope, createCustomerStudioExceptionLedger, summarizeCustomerStudioAnalytics } from './analytics-customer-studio.mjs';
import { createCustomerStudioOperationsBoard, createCustomerStudioShiftChecklist, createCustomerStudioIncidentDeck } from './operations-customer-studio.mjs';
import { createCustomerStudioReportCards, createCustomerStudioReviewPackets, summarizeCustomerStudioReporting } from './reporting-customer-studio.mjs';
import { createCustomerStudioAuditTrail, createCustomerStudioEvidenceManifest, createCustomerStudioReadinessAttestation } from './audit-customer-studio.mjs';
import { createCustomerStudioPlaybooks, createCustomerStudioDecisionDeck, createCustomerStudioEscalationMoments } from './playbooks-customer-studio.mjs';

export function buildCustomerStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerStudioWorkspace(workspaceName);
  const policies = createCustomerStudioPolicies();
  return {
    workspace,
    summary: summarizeCustomerStudioWorkspace(workspace),
    narratives: createCustomerStudioNarratives(workspace),
    coverage: createCustomerStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerStudioPolicies(policies),
    validation: validateCustomerStudioPolicies(policies),
    escalationDeck: createCustomerStudioEscalationDeck(policies),
    analytics: {
      timeline: createCustomerStudioAnalyticsTimeline(),
      forecast: createCustomerStudioForecastEnvelope(),
      exceptions: createCustomerStudioExceptionLedger(),
      summary: summarizeCustomerStudioAnalytics()
    },
    operations: {
      board: createCustomerStudioOperationsBoard(),
      checklist: createCustomerStudioShiftChecklist(),
      incidents: createCustomerStudioIncidentDeck()
    },
    reporting: {
      cards: createCustomerStudioReportCards(),
      packets: createCustomerStudioReviewPackets(),
      summary: summarizeCustomerStudioReporting()
    },
    audit: {
      trail: createCustomerStudioAuditTrail(),
      manifest: createCustomerStudioEvidenceManifest(),
      attestation: createCustomerStudioReadinessAttestation()
    },
    playbooks: createCustomerStudioPlaybooks(),
    decisions: createCustomerStudioDecisionDeck(),
    escalationMoments: createCustomerStudioEscalationMoments()
  };
}

export function createCustomerStudioReadinessBoard(snapshot = buildCustomerStudioSnapshot()) {
  return [
    { id: 'customer-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerStudioApiDocument(snapshot = buildCustomerStudioSnapshot()) {
  return {
    id: 'customer-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-studio/overview' },
      { method: 'GET', path: '/api/customer-studio/reporting' },
      { method: 'POST', path: '/api/customer-studio/validate' },
      { method: 'GET', path: '/api/customer-studio/audit' }
    ],
    readiness: createCustomerStudioReadinessBoard(snapshot)
  };
}

export function createCustomerStudioRouteSummary(snapshot = buildCustomerStudioSnapshot()) {
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

