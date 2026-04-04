import { createAudienceDossierWorkspace, summarizeAudienceDossierWorkspace, createAudienceDossierNarratives, createAudienceDossierCoverageGrid } from './domain-audience-dossier.mjs';
import { createAudienceDossierPolicies, validateAudienceDossierPolicies, summarizeAudienceDossierPolicies, createAudienceDossierEscalationDeck } from './policies-audience-dossier.mjs';
import { createAudienceDossierAnalyticsTimeline, createAudienceDossierForecastEnvelope, createAudienceDossierExceptionLedger, summarizeAudienceDossierAnalytics } from './analytics-audience-dossier.mjs';
import { createAudienceDossierOperationsBoard, createAudienceDossierShiftChecklist, createAudienceDossierIncidentDeck } from './operations-audience-dossier.mjs';
import { createAudienceDossierReportCards, createAudienceDossierReviewPackets, summarizeAudienceDossierReporting } from './reporting-audience-dossier.mjs';
import { createAudienceDossierAuditTrail, createAudienceDossierEvidenceManifest, createAudienceDossierReadinessAttestation } from './audit-audience-dossier.mjs';
import { createAudienceDossierPlaybooks, createAudienceDossierDecisionDeck, createAudienceDossierEscalationMoments } from './playbooks-audience-dossier.mjs';

export function buildAudienceDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceDossierWorkspace(workspaceName);
  const policies = createAudienceDossierPolicies();
  return {
    workspace,
    summary: summarizeAudienceDossierWorkspace(workspace),
    narratives: createAudienceDossierNarratives(workspace),
    coverage: createAudienceDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceDossierPolicies(policies),
    validation: validateAudienceDossierPolicies(policies),
    escalationDeck: createAudienceDossierEscalationDeck(policies),
    analytics: {
      timeline: createAudienceDossierAnalyticsTimeline(),
      forecast: createAudienceDossierForecastEnvelope(),
      exceptions: createAudienceDossierExceptionLedger(),
      summary: summarizeAudienceDossierAnalytics()
    },
    operations: {
      board: createAudienceDossierOperationsBoard(),
      checklist: createAudienceDossierShiftChecklist(),
      incidents: createAudienceDossierIncidentDeck()
    },
    reporting: {
      cards: createAudienceDossierReportCards(),
      packets: createAudienceDossierReviewPackets(),
      summary: summarizeAudienceDossierReporting()
    },
    audit: {
      trail: createAudienceDossierAuditTrail(),
      manifest: createAudienceDossierEvidenceManifest(),
      attestation: createAudienceDossierReadinessAttestation()
    },
    playbooks: createAudienceDossierPlaybooks(),
    decisions: createAudienceDossierDecisionDeck(),
    escalationMoments: createAudienceDossierEscalationMoments()
  };
}

export function createAudienceDossierReadinessBoard(snapshot = buildAudienceDossierSnapshot()) {
  return [
    { id: 'audience-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceDossierApiDocument(snapshot = buildAudienceDossierSnapshot()) {
  return {
    id: 'audience-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-dossier/overview' },
      { method: 'GET', path: '/api/audience-dossier/reporting' },
      { method: 'POST', path: '/api/audience-dossier/validate' },
      { method: 'GET', path: '/api/audience-dossier/audit' }
    ],
    readiness: createAudienceDossierReadinessBoard(snapshot)
  };
}

export function createAudienceDossierRouteSummary(snapshot = buildAudienceDossierSnapshot()) {
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

