import { createCollaborationDossierWorkspace, summarizeCollaborationDossierWorkspace, createCollaborationDossierNarratives, createCollaborationDossierCoverageGrid } from './domain-collaboration-dossier.mjs';
import { createCollaborationDossierPolicies, validateCollaborationDossierPolicies, summarizeCollaborationDossierPolicies, createCollaborationDossierEscalationDeck } from './policies-collaboration-dossier.mjs';
import { createCollaborationDossierAnalyticsTimeline, createCollaborationDossierForecastEnvelope, createCollaborationDossierExceptionLedger, summarizeCollaborationDossierAnalytics } from './analytics-collaboration-dossier.mjs';
import { createCollaborationDossierOperationsBoard, createCollaborationDossierShiftChecklist, createCollaborationDossierIncidentDeck } from './operations-collaboration-dossier.mjs';
import { createCollaborationDossierReportCards, createCollaborationDossierReviewPackets, summarizeCollaborationDossierReporting } from './reporting-collaboration-dossier.mjs';
import { createCollaborationDossierAuditTrail, createCollaborationDossierEvidenceManifest, createCollaborationDossierReadinessAttestation } from './audit-collaboration-dossier.mjs';
import { createCollaborationDossierPlaybooks, createCollaborationDossierDecisionDeck, createCollaborationDossierEscalationMoments } from './playbooks-collaboration-dossier.mjs';

export function buildCollaborationDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationDossierWorkspace(workspaceName);
  const policies = createCollaborationDossierPolicies();
  return {
    workspace,
    summary: summarizeCollaborationDossierWorkspace(workspace),
    narratives: createCollaborationDossierNarratives(workspace),
    coverage: createCollaborationDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationDossierPolicies(policies),
    validation: validateCollaborationDossierPolicies(policies),
    escalationDeck: createCollaborationDossierEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationDossierAnalyticsTimeline(),
      forecast: createCollaborationDossierForecastEnvelope(),
      exceptions: createCollaborationDossierExceptionLedger(),
      summary: summarizeCollaborationDossierAnalytics()
    },
    operations: {
      board: createCollaborationDossierOperationsBoard(),
      checklist: createCollaborationDossierShiftChecklist(),
      incidents: createCollaborationDossierIncidentDeck()
    },
    reporting: {
      cards: createCollaborationDossierReportCards(),
      packets: createCollaborationDossierReviewPackets(),
      summary: summarizeCollaborationDossierReporting()
    },
    audit: {
      trail: createCollaborationDossierAuditTrail(),
      manifest: createCollaborationDossierEvidenceManifest(),
      attestation: createCollaborationDossierReadinessAttestation()
    },
    playbooks: createCollaborationDossierPlaybooks(),
    decisions: createCollaborationDossierDecisionDeck(),
    escalationMoments: createCollaborationDossierEscalationMoments()
  };
}

export function createCollaborationDossierReadinessBoard(snapshot = buildCollaborationDossierSnapshot()) {
  return [
    { id: 'collaboration-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationDossierApiDocument(snapshot = buildCollaborationDossierSnapshot()) {
  return {
    id: 'collaboration-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-dossier/overview' },
      { method: 'GET', path: '/api/collaboration-dossier/reporting' },
      { method: 'POST', path: '/api/collaboration-dossier/validate' },
      { method: 'GET', path: '/api/collaboration-dossier/audit' }
    ],
    readiness: createCollaborationDossierReadinessBoard(snapshot)
  };
}

export function createCollaborationDossierRouteSummary(snapshot = buildCollaborationDossierSnapshot()) {
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

