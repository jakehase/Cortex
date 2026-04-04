import { createEcommerceStudioWorkspace, summarizeEcommerceStudioWorkspace, createEcommerceStudioNarratives, createEcommerceStudioCoverageGrid } from './domain-ecommerce-studio.mjs';
import { createEcommerceStudioPolicies, validateEcommerceStudioPolicies, summarizeEcommerceStudioPolicies, createEcommerceStudioEscalationDeck } from './policies-ecommerce-studio.mjs';
import { createEcommerceStudioAnalyticsTimeline, createEcommerceStudioForecastEnvelope, createEcommerceStudioExceptionLedger, summarizeEcommerceStudioAnalytics } from './analytics-ecommerce-studio.mjs';
import { createEcommerceStudioOperationsBoard, createEcommerceStudioShiftChecklist, createEcommerceStudioIncidentDeck } from './operations-ecommerce-studio.mjs';
import { createEcommerceStudioReportCards, createEcommerceStudioReviewPackets, summarizeEcommerceStudioReporting } from './reporting-ecommerce-studio.mjs';
import { createEcommerceStudioAuditTrail, createEcommerceStudioEvidenceManifest, createEcommerceStudioReadinessAttestation } from './audit-ecommerce-studio.mjs';
import { createEcommerceStudioPlaybooks, createEcommerceStudioDecisionDeck, createEcommerceStudioEscalationMoments } from './playbooks-ecommerce-studio.mjs';

export function buildEcommerceStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceStudioWorkspace(workspaceName);
  const policies = createEcommerceStudioPolicies();
  return {
    workspace,
    summary: summarizeEcommerceStudioWorkspace(workspace),
    narratives: createEcommerceStudioNarratives(workspace),
    coverage: createEcommerceStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceStudioPolicies(policies),
    validation: validateEcommerceStudioPolicies(policies),
    escalationDeck: createEcommerceStudioEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceStudioAnalyticsTimeline(),
      forecast: createEcommerceStudioForecastEnvelope(),
      exceptions: createEcommerceStudioExceptionLedger(),
      summary: summarizeEcommerceStudioAnalytics()
    },
    operations: {
      board: createEcommerceStudioOperationsBoard(),
      checklist: createEcommerceStudioShiftChecklist(),
      incidents: createEcommerceStudioIncidentDeck()
    },
    reporting: {
      cards: createEcommerceStudioReportCards(),
      packets: createEcommerceStudioReviewPackets(),
      summary: summarizeEcommerceStudioReporting()
    },
    audit: {
      trail: createEcommerceStudioAuditTrail(),
      manifest: createEcommerceStudioEvidenceManifest(),
      attestation: createEcommerceStudioReadinessAttestation()
    },
    playbooks: createEcommerceStudioPlaybooks(),
    decisions: createEcommerceStudioDecisionDeck(),
    escalationMoments: createEcommerceStudioEscalationMoments()
  };
}

export function createEcommerceStudioReadinessBoard(snapshot = buildEcommerceStudioSnapshot()) {
  return [
    { id: 'ecommerce-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceStudioApiDocument(snapshot = buildEcommerceStudioSnapshot()) {
  return {
    id: 'ecommerce-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-studio/overview' },
      { method: 'GET', path: '/api/ecommerce-studio/reporting' },
      { method: 'POST', path: '/api/ecommerce-studio/validate' },
      { method: 'GET', path: '/api/ecommerce-studio/audit' }
    ],
    readiness: createEcommerceStudioReadinessBoard(snapshot)
  };
}

export function createEcommerceStudioRouteSummary(snapshot = buildEcommerceStudioSnapshot()) {
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

