import { createLifecycleDossierWorkspace, summarizeLifecycleDossierWorkspace, createLifecycleDossierNarratives, createLifecycleDossierCoverageGrid } from './domain-lifecycle-dossier.mjs';
import { createLifecycleDossierPolicies, validateLifecycleDossierPolicies, summarizeLifecycleDossierPolicies, createLifecycleDossierEscalationDeck } from './policies-lifecycle-dossier.mjs';
import { createLifecycleDossierAnalyticsTimeline, createLifecycleDossierForecastEnvelope, createLifecycleDossierExceptionLedger, summarizeLifecycleDossierAnalytics } from './analytics-lifecycle-dossier.mjs';
import { createLifecycleDossierOperationsBoard, createLifecycleDossierShiftChecklist, createLifecycleDossierIncidentDeck } from './operations-lifecycle-dossier.mjs';
import { createLifecycleDossierReportCards, createLifecycleDossierReviewPackets, summarizeLifecycleDossierReporting } from './reporting-lifecycle-dossier.mjs';
import { createLifecycleDossierAuditTrail, createLifecycleDossierEvidenceManifest, createLifecycleDossierReadinessAttestation } from './audit-lifecycle-dossier.mjs';
import { createLifecycleDossierPlaybooks, createLifecycleDossierDecisionDeck, createLifecycleDossierEscalationMoments } from './playbooks-lifecycle-dossier.mjs';

export function buildLifecycleDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleDossierWorkspace(workspaceName);
  const policies = createLifecycleDossierPolicies();
  return {
    workspace,
    summary: summarizeLifecycleDossierWorkspace(workspace),
    narratives: createLifecycleDossierNarratives(workspace),
    coverage: createLifecycleDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleDossierPolicies(policies),
    validation: validateLifecycleDossierPolicies(policies),
    escalationDeck: createLifecycleDossierEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleDossierAnalyticsTimeline(),
      forecast: createLifecycleDossierForecastEnvelope(),
      exceptions: createLifecycleDossierExceptionLedger(),
      summary: summarizeLifecycleDossierAnalytics()
    },
    operations: {
      board: createLifecycleDossierOperationsBoard(),
      checklist: createLifecycleDossierShiftChecklist(),
      incidents: createLifecycleDossierIncidentDeck()
    },
    reporting: {
      cards: createLifecycleDossierReportCards(),
      packets: createLifecycleDossierReviewPackets(),
      summary: summarizeLifecycleDossierReporting()
    },
    audit: {
      trail: createLifecycleDossierAuditTrail(),
      manifest: createLifecycleDossierEvidenceManifest(),
      attestation: createLifecycleDossierReadinessAttestation()
    },
    playbooks: createLifecycleDossierPlaybooks(),
    decisions: createLifecycleDossierDecisionDeck(),
    escalationMoments: createLifecycleDossierEscalationMoments()
  };
}

export function createLifecycleDossierReadinessBoard(snapshot = buildLifecycleDossierSnapshot()) {
  return [
    { id: 'lifecycle-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleDossierApiDocument(snapshot = buildLifecycleDossierSnapshot()) {
  return {
    id: 'lifecycle-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-dossier/overview' },
      { method: 'GET', path: '/api/lifecycle-dossier/reporting' },
      { method: 'POST', path: '/api/lifecycle-dossier/validate' },
      { method: 'GET', path: '/api/lifecycle-dossier/audit' }
    ],
    readiness: createLifecycleDossierReadinessBoard(snapshot)
  };
}

export function createLifecycleDossierRouteSummary(snapshot = buildLifecycleDossierSnapshot()) {
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

