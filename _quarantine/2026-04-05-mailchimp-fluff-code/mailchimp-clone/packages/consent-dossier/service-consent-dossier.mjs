import { createConsentDossierWorkspace, summarizeConsentDossierWorkspace, createConsentDossierNarratives, createConsentDossierCoverageGrid } from './domain-consent-dossier.mjs';
import { createConsentDossierPolicies, validateConsentDossierPolicies, summarizeConsentDossierPolicies, createConsentDossierEscalationDeck } from './policies-consent-dossier.mjs';
import { createConsentDossierAnalyticsTimeline, createConsentDossierForecastEnvelope, createConsentDossierExceptionLedger, summarizeConsentDossierAnalytics } from './analytics-consent-dossier.mjs';
import { createConsentDossierOperationsBoard, createConsentDossierShiftChecklist, createConsentDossierIncidentDeck } from './operations-consent-dossier.mjs';
import { createConsentDossierReportCards, createConsentDossierReviewPackets, summarizeConsentDossierReporting } from './reporting-consent-dossier.mjs';
import { createConsentDossierAuditTrail, createConsentDossierEvidenceManifest, createConsentDossierReadinessAttestation } from './audit-consent-dossier.mjs';
import { createConsentDossierPlaybooks, createConsentDossierDecisionDeck, createConsentDossierEscalationMoments } from './playbooks-consent-dossier.mjs';

export function buildConsentDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentDossierWorkspace(workspaceName);
  const policies = createConsentDossierPolicies();
  return {
    workspace,
    summary: summarizeConsentDossierWorkspace(workspace),
    narratives: createConsentDossierNarratives(workspace),
    coverage: createConsentDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentDossierPolicies(policies),
    validation: validateConsentDossierPolicies(policies),
    escalationDeck: createConsentDossierEscalationDeck(policies),
    analytics: {
      timeline: createConsentDossierAnalyticsTimeline(),
      forecast: createConsentDossierForecastEnvelope(),
      exceptions: createConsentDossierExceptionLedger(),
      summary: summarizeConsentDossierAnalytics()
    },
    operations: {
      board: createConsentDossierOperationsBoard(),
      checklist: createConsentDossierShiftChecklist(),
      incidents: createConsentDossierIncidentDeck()
    },
    reporting: {
      cards: createConsentDossierReportCards(),
      packets: createConsentDossierReviewPackets(),
      summary: summarizeConsentDossierReporting()
    },
    audit: {
      trail: createConsentDossierAuditTrail(),
      manifest: createConsentDossierEvidenceManifest(),
      attestation: createConsentDossierReadinessAttestation()
    },
    playbooks: createConsentDossierPlaybooks(),
    decisions: createConsentDossierDecisionDeck(),
    escalationMoments: createConsentDossierEscalationMoments()
  };
}

export function createConsentDossierReadinessBoard(snapshot = buildConsentDossierSnapshot()) {
  return [
    { id: 'consent-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentDossierApiDocument(snapshot = buildConsentDossierSnapshot()) {
  return {
    id: 'consent-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-dossier/overview' },
      { method: 'GET', path: '/api/consent-dossier/reporting' },
      { method: 'POST', path: '/api/consent-dossier/validate' },
      { method: 'GET', path: '/api/consent-dossier/audit' }
    ],
    readiness: createConsentDossierReadinessBoard(snapshot)
  };
}

export function createConsentDossierRouteSummary(snapshot = buildConsentDossierSnapshot()) {
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

