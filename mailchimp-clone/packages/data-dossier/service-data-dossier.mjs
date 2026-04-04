import { createDataDossierWorkspace, summarizeDataDossierWorkspace, createDataDossierNarratives, createDataDossierCoverageGrid } from './domain-data-dossier.mjs';
import { createDataDossierPolicies, validateDataDossierPolicies, summarizeDataDossierPolicies, createDataDossierEscalationDeck } from './policies-data-dossier.mjs';
import { createDataDossierAnalyticsTimeline, createDataDossierForecastEnvelope, createDataDossierExceptionLedger, summarizeDataDossierAnalytics } from './analytics-data-dossier.mjs';
import { createDataDossierOperationsBoard, createDataDossierShiftChecklist, createDataDossierIncidentDeck } from './operations-data-dossier.mjs';
import { createDataDossierReportCards, createDataDossierReviewPackets, summarizeDataDossierReporting } from './reporting-data-dossier.mjs';
import { createDataDossierAuditTrail, createDataDossierEvidenceManifest, createDataDossierReadinessAttestation } from './audit-data-dossier.mjs';
import { createDataDossierPlaybooks, createDataDossierDecisionDeck, createDataDossierEscalationMoments } from './playbooks-data-dossier.mjs';

export function buildDataDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataDossierWorkspace(workspaceName);
  const policies = createDataDossierPolicies();
  return {
    workspace,
    summary: summarizeDataDossierWorkspace(workspace),
    narratives: createDataDossierNarratives(workspace),
    coverage: createDataDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataDossierPolicies(policies),
    validation: validateDataDossierPolicies(policies),
    escalationDeck: createDataDossierEscalationDeck(policies),
    analytics: {
      timeline: createDataDossierAnalyticsTimeline(),
      forecast: createDataDossierForecastEnvelope(),
      exceptions: createDataDossierExceptionLedger(),
      summary: summarizeDataDossierAnalytics()
    },
    operations: {
      board: createDataDossierOperationsBoard(),
      checklist: createDataDossierShiftChecklist(),
      incidents: createDataDossierIncidentDeck()
    },
    reporting: {
      cards: createDataDossierReportCards(),
      packets: createDataDossierReviewPackets(),
      summary: summarizeDataDossierReporting()
    },
    audit: {
      trail: createDataDossierAuditTrail(),
      manifest: createDataDossierEvidenceManifest(),
      attestation: createDataDossierReadinessAttestation()
    },
    playbooks: createDataDossierPlaybooks(),
    decisions: createDataDossierDecisionDeck(),
    escalationMoments: createDataDossierEscalationMoments()
  };
}

export function createDataDossierReadinessBoard(snapshot = buildDataDossierSnapshot()) {
  return [
    { id: 'data-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataDossierApiDocument(snapshot = buildDataDossierSnapshot()) {
  return {
    id: 'data-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-dossier/overview' },
      { method: 'GET', path: '/api/data-dossier/reporting' },
      { method: 'POST', path: '/api/data-dossier/validate' },
      { method: 'GET', path: '/api/data-dossier/audit' }
    ],
    readiness: createDataDossierReadinessBoard(snapshot)
  };
}

export function createDataDossierRouteSummary(snapshot = buildDataDossierSnapshot()) {
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

