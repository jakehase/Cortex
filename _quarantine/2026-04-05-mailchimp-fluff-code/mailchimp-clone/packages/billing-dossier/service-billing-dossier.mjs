import { createBillingDossierWorkspace, summarizeBillingDossierWorkspace, createBillingDossierNarratives, createBillingDossierCoverageGrid } from './domain-billing-dossier.mjs';
import { createBillingDossierPolicies, validateBillingDossierPolicies, summarizeBillingDossierPolicies, createBillingDossierEscalationDeck } from './policies-billing-dossier.mjs';
import { createBillingDossierAnalyticsTimeline, createBillingDossierForecastEnvelope, createBillingDossierExceptionLedger, summarizeBillingDossierAnalytics } from './analytics-billing-dossier.mjs';
import { createBillingDossierOperationsBoard, createBillingDossierShiftChecklist, createBillingDossierIncidentDeck } from './operations-billing-dossier.mjs';
import { createBillingDossierReportCards, createBillingDossierReviewPackets, summarizeBillingDossierReporting } from './reporting-billing-dossier.mjs';
import { createBillingDossierAuditTrail, createBillingDossierEvidenceManifest, createBillingDossierReadinessAttestation } from './audit-billing-dossier.mjs';
import { createBillingDossierPlaybooks, createBillingDossierDecisionDeck, createBillingDossierEscalationMoments } from './playbooks-billing-dossier.mjs';

export function buildBillingDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingDossierWorkspace(workspaceName);
  const policies = createBillingDossierPolicies();
  return {
    workspace,
    summary: summarizeBillingDossierWorkspace(workspace),
    narratives: createBillingDossierNarratives(workspace),
    coverage: createBillingDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingDossierPolicies(policies),
    validation: validateBillingDossierPolicies(policies),
    escalationDeck: createBillingDossierEscalationDeck(policies),
    analytics: {
      timeline: createBillingDossierAnalyticsTimeline(),
      forecast: createBillingDossierForecastEnvelope(),
      exceptions: createBillingDossierExceptionLedger(),
      summary: summarizeBillingDossierAnalytics()
    },
    operations: {
      board: createBillingDossierOperationsBoard(),
      checklist: createBillingDossierShiftChecklist(),
      incidents: createBillingDossierIncidentDeck()
    },
    reporting: {
      cards: createBillingDossierReportCards(),
      packets: createBillingDossierReviewPackets(),
      summary: summarizeBillingDossierReporting()
    },
    audit: {
      trail: createBillingDossierAuditTrail(),
      manifest: createBillingDossierEvidenceManifest(),
      attestation: createBillingDossierReadinessAttestation()
    },
    playbooks: createBillingDossierPlaybooks(),
    decisions: createBillingDossierDecisionDeck(),
    escalationMoments: createBillingDossierEscalationMoments()
  };
}

export function createBillingDossierReadinessBoard(snapshot = buildBillingDossierSnapshot()) {
  return [
    { id: 'billing-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingDossierApiDocument(snapshot = buildBillingDossierSnapshot()) {
  return {
    id: 'billing-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-dossier/overview' },
      { method: 'GET', path: '/api/billing-dossier/reporting' },
      { method: 'POST', path: '/api/billing-dossier/validate' },
      { method: 'GET', path: '/api/billing-dossier/audit' }
    ],
    readiness: createBillingDossierReadinessBoard(snapshot)
  };
}

export function createBillingDossierRouteSummary(snapshot = buildBillingDossierSnapshot()) {
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

