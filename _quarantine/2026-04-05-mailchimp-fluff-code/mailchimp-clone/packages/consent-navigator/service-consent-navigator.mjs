import { createConsentNavigatorWorkspace, summarizeConsentNavigatorWorkspace, createConsentNavigatorNarratives, createConsentNavigatorCoverageGrid } from './domain-consent-navigator.mjs';
import { createConsentNavigatorPolicies, validateConsentNavigatorPolicies, summarizeConsentNavigatorPolicies, createConsentNavigatorEscalationDeck } from './policies-consent-navigator.mjs';
import { createConsentNavigatorAnalyticsTimeline, createConsentNavigatorForecastEnvelope, createConsentNavigatorExceptionLedger, summarizeConsentNavigatorAnalytics } from './analytics-consent-navigator.mjs';
import { createConsentNavigatorOperationsBoard, createConsentNavigatorShiftChecklist, createConsentNavigatorIncidentDeck } from './operations-consent-navigator.mjs';
import { createConsentNavigatorReportCards, createConsentNavigatorReviewPackets, summarizeConsentNavigatorReporting } from './reporting-consent-navigator.mjs';
import { createConsentNavigatorAuditTrail, createConsentNavigatorEvidenceManifest, createConsentNavigatorReadinessAttestation } from './audit-consent-navigator.mjs';
import { createConsentNavigatorPlaybooks, createConsentNavigatorDecisionDeck, createConsentNavigatorEscalationMoments } from './playbooks-consent-navigator.mjs';

export function buildConsentNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentNavigatorWorkspace(workspaceName);
  const policies = createConsentNavigatorPolicies();
  return {
    workspace,
    summary: summarizeConsentNavigatorWorkspace(workspace),
    narratives: createConsentNavigatorNarratives(workspace),
    coverage: createConsentNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentNavigatorPolicies(policies),
    validation: validateConsentNavigatorPolicies(policies),
    escalationDeck: createConsentNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createConsentNavigatorAnalyticsTimeline(),
      forecast: createConsentNavigatorForecastEnvelope(),
      exceptions: createConsentNavigatorExceptionLedger(),
      summary: summarizeConsentNavigatorAnalytics()
    },
    operations: {
      board: createConsentNavigatorOperationsBoard(),
      checklist: createConsentNavigatorShiftChecklist(),
      incidents: createConsentNavigatorIncidentDeck()
    },
    reporting: {
      cards: createConsentNavigatorReportCards(),
      packets: createConsentNavigatorReviewPackets(),
      summary: summarizeConsentNavigatorReporting()
    },
    audit: {
      trail: createConsentNavigatorAuditTrail(),
      manifest: createConsentNavigatorEvidenceManifest(),
      attestation: createConsentNavigatorReadinessAttestation()
    },
    playbooks: createConsentNavigatorPlaybooks(),
    decisions: createConsentNavigatorDecisionDeck(),
    escalationMoments: createConsentNavigatorEscalationMoments()
  };
}

export function createConsentNavigatorReadinessBoard(snapshot = buildConsentNavigatorSnapshot()) {
  return [
    { id: 'consent-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentNavigatorApiDocument(snapshot = buildConsentNavigatorSnapshot()) {
  return {
    id: 'consent-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-navigator/overview' },
      { method: 'GET', path: '/api/consent-navigator/reporting' },
      { method: 'POST', path: '/api/consent-navigator/validate' },
      { method: 'GET', path: '/api/consent-navigator/audit' }
    ],
    readiness: createConsentNavigatorReadinessBoard(snapshot)
  };
}

export function createConsentNavigatorRouteSummary(snapshot = buildConsentNavigatorSnapshot()) {
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

