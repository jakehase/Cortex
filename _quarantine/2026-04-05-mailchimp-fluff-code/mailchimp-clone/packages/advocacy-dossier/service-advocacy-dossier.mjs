import { createAdvocacyDossierWorkspace, summarizeAdvocacyDossierWorkspace, createAdvocacyDossierNarratives, createAdvocacyDossierCoverageGrid } from './domain-advocacy-dossier.mjs';
import { createAdvocacyDossierPolicies, validateAdvocacyDossierPolicies, summarizeAdvocacyDossierPolicies, createAdvocacyDossierEscalationDeck } from './policies-advocacy-dossier.mjs';
import { createAdvocacyDossierAnalyticsTimeline, createAdvocacyDossierForecastEnvelope, createAdvocacyDossierExceptionLedger, summarizeAdvocacyDossierAnalytics } from './analytics-advocacy-dossier.mjs';
import { createAdvocacyDossierOperationsBoard, createAdvocacyDossierShiftChecklist, createAdvocacyDossierIncidentDeck } from './operations-advocacy-dossier.mjs';
import { createAdvocacyDossierReportCards, createAdvocacyDossierReviewPackets, summarizeAdvocacyDossierReporting } from './reporting-advocacy-dossier.mjs';
import { createAdvocacyDossierAuditTrail, createAdvocacyDossierEvidenceManifest, createAdvocacyDossierReadinessAttestation } from './audit-advocacy-dossier.mjs';
import { createAdvocacyDossierPlaybooks, createAdvocacyDossierDecisionDeck, createAdvocacyDossierEscalationMoments } from './playbooks-advocacy-dossier.mjs';

export function buildAdvocacyDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyDossierWorkspace(workspaceName);
  const policies = createAdvocacyDossierPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyDossierWorkspace(workspace),
    narratives: createAdvocacyDossierNarratives(workspace),
    coverage: createAdvocacyDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyDossierPolicies(policies),
    validation: validateAdvocacyDossierPolicies(policies),
    escalationDeck: createAdvocacyDossierEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyDossierAnalyticsTimeline(),
      forecast: createAdvocacyDossierForecastEnvelope(),
      exceptions: createAdvocacyDossierExceptionLedger(),
      summary: summarizeAdvocacyDossierAnalytics()
    },
    operations: {
      board: createAdvocacyDossierOperationsBoard(),
      checklist: createAdvocacyDossierShiftChecklist(),
      incidents: createAdvocacyDossierIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyDossierReportCards(),
      packets: createAdvocacyDossierReviewPackets(),
      summary: summarizeAdvocacyDossierReporting()
    },
    audit: {
      trail: createAdvocacyDossierAuditTrail(),
      manifest: createAdvocacyDossierEvidenceManifest(),
      attestation: createAdvocacyDossierReadinessAttestation()
    },
    playbooks: createAdvocacyDossierPlaybooks(),
    decisions: createAdvocacyDossierDecisionDeck(),
    escalationMoments: createAdvocacyDossierEscalationMoments()
  };
}

export function createAdvocacyDossierReadinessBoard(snapshot = buildAdvocacyDossierSnapshot()) {
  return [
    { id: 'advocacy-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyDossierApiDocument(snapshot = buildAdvocacyDossierSnapshot()) {
  return {
    id: 'advocacy-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-dossier/overview' },
      { method: 'GET', path: '/api/advocacy-dossier/reporting' },
      { method: 'POST', path: '/api/advocacy-dossier/validate' },
      { method: 'GET', path: '/api/advocacy-dossier/audit' }
    ],
    readiness: createAdvocacyDossierReadinessBoard(snapshot)
  };
}

export function createAdvocacyDossierRouteSummary(snapshot = buildAdvocacyDossierSnapshot()) {
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

