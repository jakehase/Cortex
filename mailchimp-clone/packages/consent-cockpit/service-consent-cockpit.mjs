import { createConsentCockpitWorkspace, summarizeConsentCockpitWorkspace, createConsentCockpitNarratives, createConsentCockpitCoverageGrid } from './domain-consent-cockpit.mjs';
import { createConsentCockpitPolicies, validateConsentCockpitPolicies, summarizeConsentCockpitPolicies, createConsentCockpitEscalationDeck } from './policies-consent-cockpit.mjs';
import { createConsentCockpitAnalyticsTimeline, createConsentCockpitForecastEnvelope, createConsentCockpitExceptionLedger, summarizeConsentCockpitAnalytics } from './analytics-consent-cockpit.mjs';
import { createConsentCockpitOperationsBoard, createConsentCockpitShiftChecklist, createConsentCockpitIncidentDeck } from './operations-consent-cockpit.mjs';
import { createConsentCockpitReportCards, createConsentCockpitReviewPackets, summarizeConsentCockpitReporting } from './reporting-consent-cockpit.mjs';
import { createConsentCockpitAuditTrail, createConsentCockpitEvidenceManifest, createConsentCockpitReadinessAttestation } from './audit-consent-cockpit.mjs';
import { createConsentCockpitPlaybooks, createConsentCockpitDecisionDeck, createConsentCockpitEscalationMoments } from './playbooks-consent-cockpit.mjs';

export function buildConsentCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentCockpitWorkspace(workspaceName);
  const policies = createConsentCockpitPolicies();
  return {
    workspace,
    summary: summarizeConsentCockpitWorkspace(workspace),
    narratives: createConsentCockpitNarratives(workspace),
    coverage: createConsentCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentCockpitPolicies(policies),
    validation: validateConsentCockpitPolicies(policies),
    escalationDeck: createConsentCockpitEscalationDeck(policies),
    analytics: {
      timeline: createConsentCockpitAnalyticsTimeline(),
      forecast: createConsentCockpitForecastEnvelope(),
      exceptions: createConsentCockpitExceptionLedger(),
      summary: summarizeConsentCockpitAnalytics()
    },
    operations: {
      board: createConsentCockpitOperationsBoard(),
      checklist: createConsentCockpitShiftChecklist(),
      incidents: createConsentCockpitIncidentDeck()
    },
    reporting: {
      cards: createConsentCockpitReportCards(),
      packets: createConsentCockpitReviewPackets(),
      summary: summarizeConsentCockpitReporting()
    },
    audit: {
      trail: createConsentCockpitAuditTrail(),
      manifest: createConsentCockpitEvidenceManifest(),
      attestation: createConsentCockpitReadinessAttestation()
    },
    playbooks: createConsentCockpitPlaybooks(),
    decisions: createConsentCockpitDecisionDeck(),
    escalationMoments: createConsentCockpitEscalationMoments()
  };
}

export function createConsentCockpitReadinessBoard(snapshot = buildConsentCockpitSnapshot()) {
  return [
    { id: 'consent-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentCockpitApiDocument(snapshot = buildConsentCockpitSnapshot()) {
  return {
    id: 'consent-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-cockpit/overview' },
      { method: 'GET', path: '/api/consent-cockpit/reporting' },
      { method: 'POST', path: '/api/consent-cockpit/validate' },
      { method: 'GET', path: '/api/consent-cockpit/audit' }
    ],
    readiness: createConsentCockpitReadinessBoard(snapshot)
  };
}

export function createConsentCockpitRouteSummary(snapshot = buildConsentCockpitSnapshot()) {
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

