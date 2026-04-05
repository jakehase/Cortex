import { createConsentFoundryWorkspace, summarizeConsentFoundryWorkspace, createConsentFoundryNarratives, createConsentFoundryCoverageGrid } from './domain-consent-foundry.mjs';
import { createConsentFoundryPolicies, validateConsentFoundryPolicies, summarizeConsentFoundryPolicies, createConsentFoundryEscalationDeck } from './policies-consent-foundry.mjs';
import { createConsentFoundryAnalyticsTimeline, createConsentFoundryForecastEnvelope, createConsentFoundryExceptionLedger, summarizeConsentFoundryAnalytics } from './analytics-consent-foundry.mjs';
import { createConsentFoundryOperationsBoard, createConsentFoundryShiftChecklist, createConsentFoundryIncidentDeck } from './operations-consent-foundry.mjs';
import { createConsentFoundryReportCards, createConsentFoundryReviewPackets, summarizeConsentFoundryReporting } from './reporting-consent-foundry.mjs';
import { createConsentFoundryAuditTrail, createConsentFoundryEvidenceManifest, createConsentFoundryReadinessAttestation } from './audit-consent-foundry.mjs';
import { createConsentFoundryPlaybooks, createConsentFoundryDecisionDeck, createConsentFoundryEscalationMoments } from './playbooks-consent-foundry.mjs';

export function buildConsentFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentFoundryWorkspace(workspaceName);
  const policies = createConsentFoundryPolicies();
  return {
    workspace,
    summary: summarizeConsentFoundryWorkspace(workspace),
    narratives: createConsentFoundryNarratives(workspace),
    coverage: createConsentFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentFoundryPolicies(policies),
    validation: validateConsentFoundryPolicies(policies),
    escalationDeck: createConsentFoundryEscalationDeck(policies),
    analytics: {
      timeline: createConsentFoundryAnalyticsTimeline(),
      forecast: createConsentFoundryForecastEnvelope(),
      exceptions: createConsentFoundryExceptionLedger(),
      summary: summarizeConsentFoundryAnalytics()
    },
    operations: {
      board: createConsentFoundryOperationsBoard(),
      checklist: createConsentFoundryShiftChecklist(),
      incidents: createConsentFoundryIncidentDeck()
    },
    reporting: {
      cards: createConsentFoundryReportCards(),
      packets: createConsentFoundryReviewPackets(),
      summary: summarizeConsentFoundryReporting()
    },
    audit: {
      trail: createConsentFoundryAuditTrail(),
      manifest: createConsentFoundryEvidenceManifest(),
      attestation: createConsentFoundryReadinessAttestation()
    },
    playbooks: createConsentFoundryPlaybooks(),
    decisions: createConsentFoundryDecisionDeck(),
    escalationMoments: createConsentFoundryEscalationMoments()
  };
}

export function createConsentFoundryReadinessBoard(snapshot = buildConsentFoundrySnapshot()) {
  return [
    { id: 'consent-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentFoundryApiDocument(snapshot = buildConsentFoundrySnapshot()) {
  return {
    id: 'consent-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-foundry/overview' },
      { method: 'GET', path: '/api/consent-foundry/reporting' },
      { method: 'POST', path: '/api/consent-foundry/validate' },
      { method: 'GET', path: '/api/consent-foundry/audit' }
    ],
    readiness: createConsentFoundryReadinessBoard(snapshot)
  };
}

export function createConsentFoundryRouteSummary(snapshot = buildConsentFoundrySnapshot()) {
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

