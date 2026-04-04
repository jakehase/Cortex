import { createConsentScorecardWorkspace, summarizeConsentScorecardWorkspace, createConsentScorecardNarratives, createConsentScorecardCoverageGrid } from './domain-consent-scorecard.mjs';
import { createConsentScorecardPolicies, validateConsentScorecardPolicies, summarizeConsentScorecardPolicies, createConsentScorecardEscalationDeck } from './policies-consent-scorecard.mjs';
import { createConsentScorecardAnalyticsTimeline, createConsentScorecardForecastEnvelope, createConsentScorecardExceptionLedger, summarizeConsentScorecardAnalytics } from './analytics-consent-scorecard.mjs';
import { createConsentScorecardOperationsBoard, createConsentScorecardShiftChecklist, createConsentScorecardIncidentDeck } from './operations-consent-scorecard.mjs';
import { createConsentScorecardReportCards, createConsentScorecardReviewPackets, summarizeConsentScorecardReporting } from './reporting-consent-scorecard.mjs';
import { createConsentScorecardAuditTrail, createConsentScorecardEvidenceManifest, createConsentScorecardReadinessAttestation } from './audit-consent-scorecard.mjs';
import { createConsentScorecardPlaybooks, createConsentScorecardDecisionDeck, createConsentScorecardEscalationMoments } from './playbooks-consent-scorecard.mjs';

export function buildConsentScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentScorecardWorkspace(workspaceName);
  const policies = createConsentScorecardPolicies();
  return {
    workspace,
    summary: summarizeConsentScorecardWorkspace(workspace),
    narratives: createConsentScorecardNarratives(workspace),
    coverage: createConsentScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentScorecardPolicies(policies),
    validation: validateConsentScorecardPolicies(policies),
    escalationDeck: createConsentScorecardEscalationDeck(policies),
    analytics: {
      timeline: createConsentScorecardAnalyticsTimeline(),
      forecast: createConsentScorecardForecastEnvelope(),
      exceptions: createConsentScorecardExceptionLedger(),
      summary: summarizeConsentScorecardAnalytics()
    },
    operations: {
      board: createConsentScorecardOperationsBoard(),
      checklist: createConsentScorecardShiftChecklist(),
      incidents: createConsentScorecardIncidentDeck()
    },
    reporting: {
      cards: createConsentScorecardReportCards(),
      packets: createConsentScorecardReviewPackets(),
      summary: summarizeConsentScorecardReporting()
    },
    audit: {
      trail: createConsentScorecardAuditTrail(),
      manifest: createConsentScorecardEvidenceManifest(),
      attestation: createConsentScorecardReadinessAttestation()
    },
    playbooks: createConsentScorecardPlaybooks(),
    decisions: createConsentScorecardDecisionDeck(),
    escalationMoments: createConsentScorecardEscalationMoments()
  };
}

export function createConsentScorecardReadinessBoard(snapshot = buildConsentScorecardSnapshot()) {
  return [
    { id: 'consent-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentScorecardApiDocument(snapshot = buildConsentScorecardSnapshot()) {
  return {
    id: 'consent-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-scorecard/overview' },
      { method: 'GET', path: '/api/consent-scorecard/reporting' },
      { method: 'POST', path: '/api/consent-scorecard/validate' },
      { method: 'GET', path: '/api/consent-scorecard/audit' }
    ],
    readiness: createConsentScorecardReadinessBoard(snapshot)
  };
}

export function createConsentScorecardRouteSummary(snapshot = buildConsentScorecardSnapshot()) {
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

