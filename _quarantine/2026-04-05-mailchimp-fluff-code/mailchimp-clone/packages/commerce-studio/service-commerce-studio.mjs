import { createCommerceStudioWorkspace, summarizeCommerceStudioWorkspace, createCommerceStudioNarratives, createCommerceStudioCoverageGrid } from './domain-commerce-studio.mjs';
import { createCommerceStudioPolicies, validateCommerceStudioPolicies, summarizeCommerceStudioPolicies, createCommerceStudioEscalationDeck } from './policies-commerce-studio.mjs';
import { createCommerceStudioAnalyticsTimeline, createCommerceStudioForecastEnvelope, createCommerceStudioExceptionLedger, summarizeCommerceStudioAnalytics } from './analytics-commerce-studio.mjs';
import { createCommerceStudioOperationsBoard, createCommerceStudioShiftChecklist, createCommerceStudioIncidentDeck } from './operations-commerce-studio.mjs';
import { createCommerceStudioReportCards, createCommerceStudioReviewPackets, summarizeCommerceStudioReporting } from './reporting-commerce-studio.mjs';
import { createCommerceStudioAuditTrail, createCommerceStudioEvidenceManifest, createCommerceStudioReadinessAttestation } from './audit-commerce-studio.mjs';
import { createCommerceStudioPlaybooks, createCommerceStudioDecisionDeck, createCommerceStudioEscalationMoments } from './playbooks-commerce-studio.mjs';

export function buildCommerceStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceStudioWorkspace(workspaceName);
  const policies = createCommerceStudioPolicies();
  return {
    workspace,
    summary: summarizeCommerceStudioWorkspace(workspace),
    narratives: createCommerceStudioNarratives(workspace),
    coverage: createCommerceStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceStudioPolicies(policies),
    validation: validateCommerceStudioPolicies(policies),
    escalationDeck: createCommerceStudioEscalationDeck(policies),
    analytics: {
      timeline: createCommerceStudioAnalyticsTimeline(),
      forecast: createCommerceStudioForecastEnvelope(),
      exceptions: createCommerceStudioExceptionLedger(),
      summary: summarizeCommerceStudioAnalytics()
    },
    operations: {
      board: createCommerceStudioOperationsBoard(),
      checklist: createCommerceStudioShiftChecklist(),
      incidents: createCommerceStudioIncidentDeck()
    },
    reporting: {
      cards: createCommerceStudioReportCards(),
      packets: createCommerceStudioReviewPackets(),
      summary: summarizeCommerceStudioReporting()
    },
    audit: {
      trail: createCommerceStudioAuditTrail(),
      manifest: createCommerceStudioEvidenceManifest(),
      attestation: createCommerceStudioReadinessAttestation()
    },
    playbooks: createCommerceStudioPlaybooks(),
    decisions: createCommerceStudioDecisionDeck(),
    escalationMoments: createCommerceStudioEscalationMoments()
  };
}

export function createCommerceStudioReadinessBoard(snapshot = buildCommerceStudioSnapshot()) {
  return [
    { id: 'commerce-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceStudioApiDocument(snapshot = buildCommerceStudioSnapshot()) {
  return {
    id: 'commerce-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-studio/overview' },
      { method: 'GET', path: '/api/commerce-studio/reporting' },
      { method: 'POST', path: '/api/commerce-studio/validate' },
      { method: 'GET', path: '/api/commerce-studio/audit' }
    ],
    readiness: createCommerceStudioReadinessBoard(snapshot)
  };
}

export function createCommerceStudioRouteSummary(snapshot = buildCommerceStudioSnapshot()) {
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

