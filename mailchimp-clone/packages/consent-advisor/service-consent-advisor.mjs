import { createConsentAdvisorWorkspace, summarizeConsentAdvisorWorkspace, createConsentAdvisorNarratives, createConsentAdvisorCoverageGrid } from './domain-consent-advisor.mjs';
import { createConsentAdvisorPolicies, validateConsentAdvisorPolicies, summarizeConsentAdvisorPolicies, createConsentAdvisorEscalationDeck } from './policies-consent-advisor.mjs';
import { createConsentAdvisorAnalyticsTimeline, createConsentAdvisorForecastEnvelope, createConsentAdvisorExceptionLedger, summarizeConsentAdvisorAnalytics } from './analytics-consent-advisor.mjs';
import { createConsentAdvisorOperationsBoard, createConsentAdvisorShiftChecklist, createConsentAdvisorIncidentDeck } from './operations-consent-advisor.mjs';
import { createConsentAdvisorReportCards, createConsentAdvisorReviewPackets, summarizeConsentAdvisorReporting } from './reporting-consent-advisor.mjs';
import { createConsentAdvisorAuditTrail, createConsentAdvisorEvidenceManifest, createConsentAdvisorReadinessAttestation } from './audit-consent-advisor.mjs';
import { createConsentAdvisorPlaybooks, createConsentAdvisorDecisionDeck, createConsentAdvisorEscalationMoments } from './playbooks-consent-advisor.mjs';

export function buildConsentAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentAdvisorWorkspace(workspaceName);
  const policies = createConsentAdvisorPolicies();
  return {
    workspace,
    summary: summarizeConsentAdvisorWorkspace(workspace),
    narratives: createConsentAdvisorNarratives(workspace),
    coverage: createConsentAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentAdvisorPolicies(policies),
    validation: validateConsentAdvisorPolicies(policies),
    escalationDeck: createConsentAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createConsentAdvisorAnalyticsTimeline(),
      forecast: createConsentAdvisorForecastEnvelope(),
      exceptions: createConsentAdvisorExceptionLedger(),
      summary: summarizeConsentAdvisorAnalytics()
    },
    operations: {
      board: createConsentAdvisorOperationsBoard(),
      checklist: createConsentAdvisorShiftChecklist(),
      incidents: createConsentAdvisorIncidentDeck()
    },
    reporting: {
      cards: createConsentAdvisorReportCards(),
      packets: createConsentAdvisorReviewPackets(),
      summary: summarizeConsentAdvisorReporting()
    },
    audit: {
      trail: createConsentAdvisorAuditTrail(),
      manifest: createConsentAdvisorEvidenceManifest(),
      attestation: createConsentAdvisorReadinessAttestation()
    },
    playbooks: createConsentAdvisorPlaybooks(),
    decisions: createConsentAdvisorDecisionDeck(),
    escalationMoments: createConsentAdvisorEscalationMoments()
  };
}

export function createConsentAdvisorReadinessBoard(snapshot = buildConsentAdvisorSnapshot()) {
  return [
    { id: 'consent-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentAdvisorApiDocument(snapshot = buildConsentAdvisorSnapshot()) {
  return {
    id: 'consent-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-advisor/overview' },
      { method: 'GET', path: '/api/consent-advisor/reporting' },
      { method: 'POST', path: '/api/consent-advisor/validate' },
      { method: 'GET', path: '/api/consent-advisor/audit' }
    ],
    readiness: createConsentAdvisorReadinessBoard(snapshot)
  };
}

export function createConsentAdvisorRouteSummary(snapshot = buildConsentAdvisorSnapshot()) {
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

