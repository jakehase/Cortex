import { createConsentStudioWorkspace, summarizeConsentStudioWorkspace, createConsentStudioNarratives, createConsentStudioCoverageGrid } from './domain-consent-studio.mjs';
import { createConsentStudioPolicies, validateConsentStudioPolicies, summarizeConsentStudioPolicies, createConsentStudioEscalationDeck } from './policies-consent-studio.mjs';
import { createConsentStudioAnalyticsTimeline, createConsentStudioForecastEnvelope, createConsentStudioExceptionLedger, summarizeConsentStudioAnalytics } from './analytics-consent-studio.mjs';
import { createConsentStudioOperationsBoard, createConsentStudioShiftChecklist, createConsentStudioIncidentDeck } from './operations-consent-studio.mjs';
import { createConsentStudioReportCards, createConsentStudioReviewPackets, summarizeConsentStudioReporting } from './reporting-consent-studio.mjs';
import { createConsentStudioAuditTrail, createConsentStudioEvidenceManifest, createConsentStudioReadinessAttestation } from './audit-consent-studio.mjs';
import { createConsentStudioPlaybooks, createConsentStudioDecisionDeck, createConsentStudioEscalationMoments } from './playbooks-consent-studio.mjs';

export function buildConsentStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentStudioWorkspace(workspaceName);
  const policies = createConsentStudioPolicies();
  return {
    workspace,
    summary: summarizeConsentStudioWorkspace(workspace),
    narratives: createConsentStudioNarratives(workspace),
    coverage: createConsentStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentStudioPolicies(policies),
    validation: validateConsentStudioPolicies(policies),
    escalationDeck: createConsentStudioEscalationDeck(policies),
    analytics: {
      timeline: createConsentStudioAnalyticsTimeline(),
      forecast: createConsentStudioForecastEnvelope(),
      exceptions: createConsentStudioExceptionLedger(),
      summary: summarizeConsentStudioAnalytics()
    },
    operations: {
      board: createConsentStudioOperationsBoard(),
      checklist: createConsentStudioShiftChecklist(),
      incidents: createConsentStudioIncidentDeck()
    },
    reporting: {
      cards: createConsentStudioReportCards(),
      packets: createConsentStudioReviewPackets(),
      summary: summarizeConsentStudioReporting()
    },
    audit: {
      trail: createConsentStudioAuditTrail(),
      manifest: createConsentStudioEvidenceManifest(),
      attestation: createConsentStudioReadinessAttestation()
    },
    playbooks: createConsentStudioPlaybooks(),
    decisions: createConsentStudioDecisionDeck(),
    escalationMoments: createConsentStudioEscalationMoments()
  };
}

export function createConsentStudioReadinessBoard(snapshot = buildConsentStudioSnapshot()) {
  return [
    { id: 'consent-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentStudioApiDocument(snapshot = buildConsentStudioSnapshot()) {
  return {
    id: 'consent-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-studio/overview' },
      { method: 'GET', path: '/api/consent-studio/reporting' },
      { method: 'POST', path: '/api/consent-studio/validate' },
      { method: 'GET', path: '/api/consent-studio/audit' }
    ],
    readiness: createConsentStudioReadinessBoard(snapshot)
  };
}

export function createConsentStudioRouteSummary(snapshot = buildConsentStudioSnapshot()) {
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

