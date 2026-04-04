import { createConsentWatchtowerWorkspace, summarizeConsentWatchtowerWorkspace, createConsentWatchtowerNarratives, createConsentWatchtowerCoverageGrid } from './domain-consent-watchtower.mjs';
import { createConsentWatchtowerPolicies, validateConsentWatchtowerPolicies, summarizeConsentWatchtowerPolicies, createConsentWatchtowerEscalationDeck } from './policies-consent-watchtower.mjs';
import { createConsentWatchtowerAnalyticsTimeline, createConsentWatchtowerForecastEnvelope, createConsentWatchtowerExceptionLedger, summarizeConsentWatchtowerAnalytics } from './analytics-consent-watchtower.mjs';
import { createConsentWatchtowerOperationsBoard, createConsentWatchtowerShiftChecklist, createConsentWatchtowerIncidentDeck } from './operations-consent-watchtower.mjs';
import { createConsentWatchtowerReportCards, createConsentWatchtowerReviewPackets, summarizeConsentWatchtowerReporting } from './reporting-consent-watchtower.mjs';
import { createConsentWatchtowerAuditTrail, createConsentWatchtowerEvidenceManifest, createConsentWatchtowerReadinessAttestation } from './audit-consent-watchtower.mjs';
import { createConsentWatchtowerPlaybooks, createConsentWatchtowerDecisionDeck, createConsentWatchtowerEscalationMoments } from './playbooks-consent-watchtower.mjs';

export function buildConsentWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentWatchtowerWorkspace(workspaceName);
  const policies = createConsentWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeConsentWatchtowerWorkspace(workspace),
    narratives: createConsentWatchtowerNarratives(workspace),
    coverage: createConsentWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentWatchtowerPolicies(policies),
    validation: validateConsentWatchtowerPolicies(policies),
    escalationDeck: createConsentWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createConsentWatchtowerAnalyticsTimeline(),
      forecast: createConsentWatchtowerForecastEnvelope(),
      exceptions: createConsentWatchtowerExceptionLedger(),
      summary: summarizeConsentWatchtowerAnalytics()
    },
    operations: {
      board: createConsentWatchtowerOperationsBoard(),
      checklist: createConsentWatchtowerShiftChecklist(),
      incidents: createConsentWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createConsentWatchtowerReportCards(),
      packets: createConsentWatchtowerReviewPackets(),
      summary: summarizeConsentWatchtowerReporting()
    },
    audit: {
      trail: createConsentWatchtowerAuditTrail(),
      manifest: createConsentWatchtowerEvidenceManifest(),
      attestation: createConsentWatchtowerReadinessAttestation()
    },
    playbooks: createConsentWatchtowerPlaybooks(),
    decisions: createConsentWatchtowerDecisionDeck(),
    escalationMoments: createConsentWatchtowerEscalationMoments()
  };
}

export function createConsentWatchtowerReadinessBoard(snapshot = buildConsentWatchtowerSnapshot()) {
  return [
    { id: 'consent-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentWatchtowerApiDocument(snapshot = buildConsentWatchtowerSnapshot()) {
  return {
    id: 'consent-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-watchtower/overview' },
      { method: 'GET', path: '/api/consent-watchtower/reporting' },
      { method: 'POST', path: '/api/consent-watchtower/validate' },
      { method: 'GET', path: '/api/consent-watchtower/audit' }
    ],
    readiness: createConsentWatchtowerReadinessBoard(snapshot)
  };
}

export function createConsentWatchtowerRouteSummary(snapshot = buildConsentWatchtowerSnapshot()) {
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

