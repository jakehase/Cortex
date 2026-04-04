import { createAcquisitionDossierWorkspace, summarizeAcquisitionDossierWorkspace, createAcquisitionDossierNarratives, createAcquisitionDossierCoverageGrid } from './domain-acquisition-dossier.mjs';
import { createAcquisitionDossierPolicies, validateAcquisitionDossierPolicies, summarizeAcquisitionDossierPolicies, createAcquisitionDossierEscalationDeck } from './policies-acquisition-dossier.mjs';
import { createAcquisitionDossierAnalyticsTimeline, createAcquisitionDossierForecastEnvelope, createAcquisitionDossierExceptionLedger, summarizeAcquisitionDossierAnalytics } from './analytics-acquisition-dossier.mjs';
import { createAcquisitionDossierOperationsBoard, createAcquisitionDossierShiftChecklist, createAcquisitionDossierIncidentDeck } from './operations-acquisition-dossier.mjs';
import { createAcquisitionDossierReportCards, createAcquisitionDossierReviewPackets, summarizeAcquisitionDossierReporting } from './reporting-acquisition-dossier.mjs';
import { createAcquisitionDossierAuditTrail, createAcquisitionDossierEvidenceManifest, createAcquisitionDossierReadinessAttestation } from './audit-acquisition-dossier.mjs';
import { createAcquisitionDossierPlaybooks, createAcquisitionDossierDecisionDeck, createAcquisitionDossierEscalationMoments } from './playbooks-acquisition-dossier.mjs';

export function buildAcquisitionDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionDossierWorkspace(workspaceName);
  const policies = createAcquisitionDossierPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionDossierWorkspace(workspace),
    narratives: createAcquisitionDossierNarratives(workspace),
    coverage: createAcquisitionDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionDossierPolicies(policies),
    validation: validateAcquisitionDossierPolicies(policies),
    escalationDeck: createAcquisitionDossierEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionDossierAnalyticsTimeline(),
      forecast: createAcquisitionDossierForecastEnvelope(),
      exceptions: createAcquisitionDossierExceptionLedger(),
      summary: summarizeAcquisitionDossierAnalytics()
    },
    operations: {
      board: createAcquisitionDossierOperationsBoard(),
      checklist: createAcquisitionDossierShiftChecklist(),
      incidents: createAcquisitionDossierIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionDossierReportCards(),
      packets: createAcquisitionDossierReviewPackets(),
      summary: summarizeAcquisitionDossierReporting()
    },
    audit: {
      trail: createAcquisitionDossierAuditTrail(),
      manifest: createAcquisitionDossierEvidenceManifest(),
      attestation: createAcquisitionDossierReadinessAttestation()
    },
    playbooks: createAcquisitionDossierPlaybooks(),
    decisions: createAcquisitionDossierDecisionDeck(),
    escalationMoments: createAcquisitionDossierEscalationMoments()
  };
}

export function createAcquisitionDossierReadinessBoard(snapshot = buildAcquisitionDossierSnapshot()) {
  return [
    { id: 'acquisition-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionDossierApiDocument(snapshot = buildAcquisitionDossierSnapshot()) {
  return {
    id: 'acquisition-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-dossier/overview' },
      { method: 'GET', path: '/api/acquisition-dossier/reporting' },
      { method: 'POST', path: '/api/acquisition-dossier/validate' },
      { method: 'GET', path: '/api/acquisition-dossier/audit' }
    ],
    readiness: createAcquisitionDossierReadinessBoard(snapshot)
  };
}

export function createAcquisitionDossierRouteSummary(snapshot = buildAcquisitionDossierSnapshot()) {
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

