import { createConsentSentinelWorkspace, summarizeConsentSentinelWorkspace, createConsentSentinelNarratives, createConsentSentinelCoverageGrid } from './domain-consent-sentinel.mjs';
import { createConsentSentinelPolicies, validateConsentSentinelPolicies, summarizeConsentSentinelPolicies, createConsentSentinelEscalationDeck } from './policies-consent-sentinel.mjs';
import { createConsentSentinelAnalyticsTimeline, createConsentSentinelForecastEnvelope, createConsentSentinelExceptionLedger, summarizeConsentSentinelAnalytics } from './analytics-consent-sentinel.mjs';
import { createConsentSentinelOperationsBoard, createConsentSentinelShiftChecklist, createConsentSentinelIncidentDeck } from './operations-consent-sentinel.mjs';
import { createConsentSentinelReportCards, createConsentSentinelReviewPackets, summarizeConsentSentinelReporting } from './reporting-consent-sentinel.mjs';
import { createConsentSentinelAuditTrail, createConsentSentinelEvidenceManifest, createConsentSentinelReadinessAttestation } from './audit-consent-sentinel.mjs';
import { createConsentSentinelPlaybooks, createConsentSentinelDecisionDeck, createConsentSentinelEscalationMoments } from './playbooks-consent-sentinel.mjs';

export function buildConsentSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentSentinelWorkspace(workspaceName);
  const policies = createConsentSentinelPolicies();
  return {
    workspace,
    summary: summarizeConsentSentinelWorkspace(workspace),
    narratives: createConsentSentinelNarratives(workspace),
    coverage: createConsentSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentSentinelPolicies(policies),
    validation: validateConsentSentinelPolicies(policies),
    escalationDeck: createConsentSentinelEscalationDeck(policies),
    analytics: {
      timeline: createConsentSentinelAnalyticsTimeline(),
      forecast: createConsentSentinelForecastEnvelope(),
      exceptions: createConsentSentinelExceptionLedger(),
      summary: summarizeConsentSentinelAnalytics()
    },
    operations: {
      board: createConsentSentinelOperationsBoard(),
      checklist: createConsentSentinelShiftChecklist(),
      incidents: createConsentSentinelIncidentDeck()
    },
    reporting: {
      cards: createConsentSentinelReportCards(),
      packets: createConsentSentinelReviewPackets(),
      summary: summarizeConsentSentinelReporting()
    },
    audit: {
      trail: createConsentSentinelAuditTrail(),
      manifest: createConsentSentinelEvidenceManifest(),
      attestation: createConsentSentinelReadinessAttestation()
    },
    playbooks: createConsentSentinelPlaybooks(),
    decisions: createConsentSentinelDecisionDeck(),
    escalationMoments: createConsentSentinelEscalationMoments()
  };
}

export function createConsentSentinelReadinessBoard(snapshot = buildConsentSentinelSnapshot()) {
  return [
    { id: 'consent-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentSentinelApiDocument(snapshot = buildConsentSentinelSnapshot()) {
  return {
    id: 'consent-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-sentinel/overview' },
      { method: 'GET', path: '/api/consent-sentinel/reporting' },
      { method: 'POST', path: '/api/consent-sentinel/validate' },
      { method: 'GET', path: '/api/consent-sentinel/audit' }
    ],
    readiness: createConsentSentinelReadinessBoard(snapshot)
  };
}

export function createConsentSentinelRouteSummary(snapshot = buildConsentSentinelSnapshot()) {
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

