import { createLocalizationDossierWorkspace, summarizeLocalizationDossierWorkspace, createLocalizationDossierNarratives, createLocalizationDossierCoverageGrid } from './domain-localization-dossier.mjs';
import { createLocalizationDossierPolicies, validateLocalizationDossierPolicies, summarizeLocalizationDossierPolicies, createLocalizationDossierEscalationDeck } from './policies-localization-dossier.mjs';
import { createLocalizationDossierAnalyticsTimeline, createLocalizationDossierForecastEnvelope, createLocalizationDossierExceptionLedger, summarizeLocalizationDossierAnalytics } from './analytics-localization-dossier.mjs';
import { createLocalizationDossierOperationsBoard, createLocalizationDossierShiftChecklist, createLocalizationDossierIncidentDeck } from './operations-localization-dossier.mjs';
import { createLocalizationDossierReportCards, createLocalizationDossierReviewPackets, summarizeLocalizationDossierReporting } from './reporting-localization-dossier.mjs';
import { createLocalizationDossierAuditTrail, createLocalizationDossierEvidenceManifest, createLocalizationDossierReadinessAttestation } from './audit-localization-dossier.mjs';
import { createLocalizationDossierPlaybooks, createLocalizationDossierDecisionDeck, createLocalizationDossierEscalationMoments } from './playbooks-localization-dossier.mjs';

export function buildLocalizationDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationDossierWorkspace(workspaceName);
  const policies = createLocalizationDossierPolicies();
  return {
    workspace,
    summary: summarizeLocalizationDossierWorkspace(workspace),
    narratives: createLocalizationDossierNarratives(workspace),
    coverage: createLocalizationDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationDossierPolicies(policies),
    validation: validateLocalizationDossierPolicies(policies),
    escalationDeck: createLocalizationDossierEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationDossierAnalyticsTimeline(),
      forecast: createLocalizationDossierForecastEnvelope(),
      exceptions: createLocalizationDossierExceptionLedger(),
      summary: summarizeLocalizationDossierAnalytics()
    },
    operations: {
      board: createLocalizationDossierOperationsBoard(),
      checklist: createLocalizationDossierShiftChecklist(),
      incidents: createLocalizationDossierIncidentDeck()
    },
    reporting: {
      cards: createLocalizationDossierReportCards(),
      packets: createLocalizationDossierReviewPackets(),
      summary: summarizeLocalizationDossierReporting()
    },
    audit: {
      trail: createLocalizationDossierAuditTrail(),
      manifest: createLocalizationDossierEvidenceManifest(),
      attestation: createLocalizationDossierReadinessAttestation()
    },
    playbooks: createLocalizationDossierPlaybooks(),
    decisions: createLocalizationDossierDecisionDeck(),
    escalationMoments: createLocalizationDossierEscalationMoments()
  };
}

export function createLocalizationDossierReadinessBoard(snapshot = buildLocalizationDossierSnapshot()) {
  return [
    { id: 'localization-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationDossierApiDocument(snapshot = buildLocalizationDossierSnapshot()) {
  return {
    id: 'localization-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-dossier/overview' },
      { method: 'GET', path: '/api/localization-dossier/reporting' },
      { method: 'POST', path: '/api/localization-dossier/validate' },
      { method: 'GET', path: '/api/localization-dossier/audit' }
    ],
    readiness: createLocalizationDossierReadinessBoard(snapshot)
  };
}

export function createLocalizationDossierRouteSummary(snapshot = buildLocalizationDossierSnapshot()) {
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

