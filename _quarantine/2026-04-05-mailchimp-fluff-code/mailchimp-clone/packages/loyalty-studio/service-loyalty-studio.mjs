import { createLoyaltyStudioWorkspace, summarizeLoyaltyStudioWorkspace, createLoyaltyStudioNarratives, createLoyaltyStudioCoverageGrid } from './domain-loyalty-studio.mjs';
import { createLoyaltyStudioPolicies, validateLoyaltyStudioPolicies, summarizeLoyaltyStudioPolicies, createLoyaltyStudioEscalationDeck } from './policies-loyalty-studio.mjs';
import { createLoyaltyStudioAnalyticsTimeline, createLoyaltyStudioForecastEnvelope, createLoyaltyStudioExceptionLedger, summarizeLoyaltyStudioAnalytics } from './analytics-loyalty-studio.mjs';
import { createLoyaltyStudioOperationsBoard, createLoyaltyStudioShiftChecklist, createLoyaltyStudioIncidentDeck } from './operations-loyalty-studio.mjs';
import { createLoyaltyStudioReportCards, createLoyaltyStudioReviewPackets, summarizeLoyaltyStudioReporting } from './reporting-loyalty-studio.mjs';
import { createLoyaltyStudioAuditTrail, createLoyaltyStudioEvidenceManifest, createLoyaltyStudioReadinessAttestation } from './audit-loyalty-studio.mjs';
import { createLoyaltyStudioPlaybooks, createLoyaltyStudioDecisionDeck, createLoyaltyStudioEscalationMoments } from './playbooks-loyalty-studio.mjs';

export function buildLoyaltyStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyStudioWorkspace(workspaceName);
  const policies = createLoyaltyStudioPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyStudioWorkspace(workspace),
    narratives: createLoyaltyStudioNarratives(workspace),
    coverage: createLoyaltyStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyStudioPolicies(policies),
    validation: validateLoyaltyStudioPolicies(policies),
    escalationDeck: createLoyaltyStudioEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyStudioAnalyticsTimeline(),
      forecast: createLoyaltyStudioForecastEnvelope(),
      exceptions: createLoyaltyStudioExceptionLedger(),
      summary: summarizeLoyaltyStudioAnalytics()
    },
    operations: {
      board: createLoyaltyStudioOperationsBoard(),
      checklist: createLoyaltyStudioShiftChecklist(),
      incidents: createLoyaltyStudioIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyStudioReportCards(),
      packets: createLoyaltyStudioReviewPackets(),
      summary: summarizeLoyaltyStudioReporting()
    },
    audit: {
      trail: createLoyaltyStudioAuditTrail(),
      manifest: createLoyaltyStudioEvidenceManifest(),
      attestation: createLoyaltyStudioReadinessAttestation()
    },
    playbooks: createLoyaltyStudioPlaybooks(),
    decisions: createLoyaltyStudioDecisionDeck(),
    escalationMoments: createLoyaltyStudioEscalationMoments()
  };
}

export function createLoyaltyStudioReadinessBoard(snapshot = buildLoyaltyStudioSnapshot()) {
  return [
    { id: 'loyalty-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyStudioApiDocument(snapshot = buildLoyaltyStudioSnapshot()) {
  return {
    id: 'loyalty-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-studio/overview' },
      { method: 'GET', path: '/api/loyalty-studio/reporting' },
      { method: 'POST', path: '/api/loyalty-studio/validate' },
      { method: 'GET', path: '/api/loyalty-studio/audit' }
    ],
    readiness: createLoyaltyStudioReadinessBoard(snapshot)
  };
}

export function createLoyaltyStudioRouteSummary(snapshot = buildLoyaltyStudioSnapshot()) {
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

