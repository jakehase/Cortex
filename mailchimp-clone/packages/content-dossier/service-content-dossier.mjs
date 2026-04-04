import { createContentDossierWorkspace, summarizeContentDossierWorkspace, createContentDossierNarratives, createContentDossierCoverageGrid } from './domain-content-dossier.mjs';
import { createContentDossierPolicies, validateContentDossierPolicies, summarizeContentDossierPolicies, createContentDossierEscalationDeck } from './policies-content-dossier.mjs';
import { createContentDossierAnalyticsTimeline, createContentDossierForecastEnvelope, createContentDossierExceptionLedger, summarizeContentDossierAnalytics } from './analytics-content-dossier.mjs';
import { createContentDossierOperationsBoard, createContentDossierShiftChecklist, createContentDossierIncidentDeck } from './operations-content-dossier.mjs';
import { createContentDossierReportCards, createContentDossierReviewPackets, summarizeContentDossierReporting } from './reporting-content-dossier.mjs';
import { createContentDossierAuditTrail, createContentDossierEvidenceManifest, createContentDossierReadinessAttestation } from './audit-content-dossier.mjs';
import { createContentDossierPlaybooks, createContentDossierDecisionDeck, createContentDossierEscalationMoments } from './playbooks-content-dossier.mjs';

export function buildContentDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentDossierWorkspace(workspaceName);
  const policies = createContentDossierPolicies();
  return {
    workspace,
    summary: summarizeContentDossierWorkspace(workspace),
    narratives: createContentDossierNarratives(workspace),
    coverage: createContentDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentDossierPolicies(policies),
    validation: validateContentDossierPolicies(policies),
    escalationDeck: createContentDossierEscalationDeck(policies),
    analytics: {
      timeline: createContentDossierAnalyticsTimeline(),
      forecast: createContentDossierForecastEnvelope(),
      exceptions: createContentDossierExceptionLedger(),
      summary: summarizeContentDossierAnalytics()
    },
    operations: {
      board: createContentDossierOperationsBoard(),
      checklist: createContentDossierShiftChecklist(),
      incidents: createContentDossierIncidentDeck()
    },
    reporting: {
      cards: createContentDossierReportCards(),
      packets: createContentDossierReviewPackets(),
      summary: summarizeContentDossierReporting()
    },
    audit: {
      trail: createContentDossierAuditTrail(),
      manifest: createContentDossierEvidenceManifest(),
      attestation: createContentDossierReadinessAttestation()
    },
    playbooks: createContentDossierPlaybooks(),
    decisions: createContentDossierDecisionDeck(),
    escalationMoments: createContentDossierEscalationMoments()
  };
}

export function createContentDossierReadinessBoard(snapshot = buildContentDossierSnapshot()) {
  return [
    { id: 'content-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentDossierApiDocument(snapshot = buildContentDossierSnapshot()) {
  return {
    id: 'content-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-dossier/overview' },
      { method: 'GET', path: '/api/content-dossier/reporting' },
      { method: 'POST', path: '/api/content-dossier/validate' },
      { method: 'GET', path: '/api/content-dossier/audit' }
    ],
    readiness: createContentDossierReadinessBoard(snapshot)
  };
}

export function createContentDossierRouteSummary(snapshot = buildContentDossierSnapshot()) {
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

