import { createLoyaltyDossierWorkspace, summarizeLoyaltyDossierWorkspace, createLoyaltyDossierNarratives, createLoyaltyDossierCoverageGrid } from './domain-loyalty-dossier.mjs';
import { createLoyaltyDossierPolicies, validateLoyaltyDossierPolicies, summarizeLoyaltyDossierPolicies, createLoyaltyDossierEscalationDeck } from './policies-loyalty-dossier.mjs';
import { createLoyaltyDossierAnalyticsTimeline, createLoyaltyDossierForecastEnvelope, createLoyaltyDossierExceptionLedger, summarizeLoyaltyDossierAnalytics } from './analytics-loyalty-dossier.mjs';
import { createLoyaltyDossierOperationsBoard, createLoyaltyDossierShiftChecklist, createLoyaltyDossierIncidentDeck } from './operations-loyalty-dossier.mjs';
import { createLoyaltyDossierReportCards, createLoyaltyDossierReviewPackets, summarizeLoyaltyDossierReporting } from './reporting-loyalty-dossier.mjs';
import { createLoyaltyDossierAuditTrail, createLoyaltyDossierEvidenceManifest, createLoyaltyDossierReadinessAttestation } from './audit-loyalty-dossier.mjs';
import { createLoyaltyDossierPlaybooks, createLoyaltyDossierDecisionDeck, createLoyaltyDossierEscalationMoments } from './playbooks-loyalty-dossier.mjs';

export function buildLoyaltyDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyDossierWorkspace(workspaceName);
  const policies = createLoyaltyDossierPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyDossierWorkspace(workspace),
    narratives: createLoyaltyDossierNarratives(workspace),
    coverage: createLoyaltyDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyDossierPolicies(policies),
    validation: validateLoyaltyDossierPolicies(policies),
    escalationDeck: createLoyaltyDossierEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyDossierAnalyticsTimeline(),
      forecast: createLoyaltyDossierForecastEnvelope(),
      exceptions: createLoyaltyDossierExceptionLedger(),
      summary: summarizeLoyaltyDossierAnalytics()
    },
    operations: {
      board: createLoyaltyDossierOperationsBoard(),
      checklist: createLoyaltyDossierShiftChecklist(),
      incidents: createLoyaltyDossierIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyDossierReportCards(),
      packets: createLoyaltyDossierReviewPackets(),
      summary: summarizeLoyaltyDossierReporting()
    },
    audit: {
      trail: createLoyaltyDossierAuditTrail(),
      manifest: createLoyaltyDossierEvidenceManifest(),
      attestation: createLoyaltyDossierReadinessAttestation()
    },
    playbooks: createLoyaltyDossierPlaybooks(),
    decisions: createLoyaltyDossierDecisionDeck(),
    escalationMoments: createLoyaltyDossierEscalationMoments()
  };
}

export function createLoyaltyDossierReadinessBoard(snapshot = buildLoyaltyDossierSnapshot()) {
  return [
    { id: 'loyalty-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyDossierApiDocument(snapshot = buildLoyaltyDossierSnapshot()) {
  return {
    id: 'loyalty-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-dossier/overview' },
      { method: 'GET', path: '/api/loyalty-dossier/reporting' },
      { method: 'POST', path: '/api/loyalty-dossier/validate' },
      { method: 'GET', path: '/api/loyalty-dossier/audit' }
    ],
    readiness: createLoyaltyDossierReadinessBoard(snapshot)
  };
}

export function createLoyaltyDossierRouteSummary(snapshot = buildLoyaltyDossierSnapshot()) {
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

