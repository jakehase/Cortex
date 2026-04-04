import { createActivationDossierWorkspace, summarizeActivationDossierWorkspace, createActivationDossierNarratives, createActivationDossierCoverageGrid } from './domain-activation-dossier.mjs';
import { createActivationDossierPolicies, validateActivationDossierPolicies, summarizeActivationDossierPolicies, createActivationDossierEscalationDeck } from './policies-activation-dossier.mjs';
import { createActivationDossierAnalyticsTimeline, createActivationDossierForecastEnvelope, createActivationDossierExceptionLedger, summarizeActivationDossierAnalytics } from './analytics-activation-dossier.mjs';
import { createActivationDossierOperationsBoard, createActivationDossierShiftChecklist, createActivationDossierIncidentDeck } from './operations-activation-dossier.mjs';
import { createActivationDossierReportCards, createActivationDossierReviewPackets, summarizeActivationDossierReporting } from './reporting-activation-dossier.mjs';
import { createActivationDossierAuditTrail, createActivationDossierEvidenceManifest, createActivationDossierReadinessAttestation } from './audit-activation-dossier.mjs';
import { createActivationDossierPlaybooks, createActivationDossierDecisionDeck, createActivationDossierEscalationMoments } from './playbooks-activation-dossier.mjs';

export function buildActivationDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationDossierWorkspace(workspaceName);
  const policies = createActivationDossierPolicies();
  return {
    workspace,
    summary: summarizeActivationDossierWorkspace(workspace),
    narratives: createActivationDossierNarratives(workspace),
    coverage: createActivationDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationDossierPolicies(policies),
    validation: validateActivationDossierPolicies(policies),
    escalationDeck: createActivationDossierEscalationDeck(policies),
    analytics: {
      timeline: createActivationDossierAnalyticsTimeline(),
      forecast: createActivationDossierForecastEnvelope(),
      exceptions: createActivationDossierExceptionLedger(),
      summary: summarizeActivationDossierAnalytics()
    },
    operations: {
      board: createActivationDossierOperationsBoard(),
      checklist: createActivationDossierShiftChecklist(),
      incidents: createActivationDossierIncidentDeck()
    },
    reporting: {
      cards: createActivationDossierReportCards(),
      packets: createActivationDossierReviewPackets(),
      summary: summarizeActivationDossierReporting()
    },
    audit: {
      trail: createActivationDossierAuditTrail(),
      manifest: createActivationDossierEvidenceManifest(),
      attestation: createActivationDossierReadinessAttestation()
    },
    playbooks: createActivationDossierPlaybooks(),
    decisions: createActivationDossierDecisionDeck(),
    escalationMoments: createActivationDossierEscalationMoments()
  };
}

export function createActivationDossierReadinessBoard(snapshot = buildActivationDossierSnapshot()) {
  return [
    { id: 'activation-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationDossierApiDocument(snapshot = buildActivationDossierSnapshot()) {
  return {
    id: 'activation-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-dossier/overview' },
      { method: 'GET', path: '/api/activation-dossier/reporting' },
      { method: 'POST', path: '/api/activation-dossier/validate' },
      { method: 'GET', path: '/api/activation-dossier/audit' }
    ],
    readiness: createActivationDossierReadinessBoard(snapshot)
  };
}

export function createActivationDossierRouteSummary(snapshot = buildActivationDossierSnapshot()) {
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

