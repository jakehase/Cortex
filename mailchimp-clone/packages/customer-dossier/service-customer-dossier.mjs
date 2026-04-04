import { createCustomerDossierWorkspace, summarizeCustomerDossierWorkspace, createCustomerDossierNarratives, createCustomerDossierCoverageGrid } from './domain-customer-dossier.mjs';
import { createCustomerDossierPolicies, validateCustomerDossierPolicies, summarizeCustomerDossierPolicies, createCustomerDossierEscalationDeck } from './policies-customer-dossier.mjs';
import { createCustomerDossierAnalyticsTimeline, createCustomerDossierForecastEnvelope, createCustomerDossierExceptionLedger, summarizeCustomerDossierAnalytics } from './analytics-customer-dossier.mjs';
import { createCustomerDossierOperationsBoard, createCustomerDossierShiftChecklist, createCustomerDossierIncidentDeck } from './operations-customer-dossier.mjs';
import { createCustomerDossierReportCards, createCustomerDossierReviewPackets, summarizeCustomerDossierReporting } from './reporting-customer-dossier.mjs';
import { createCustomerDossierAuditTrail, createCustomerDossierEvidenceManifest, createCustomerDossierReadinessAttestation } from './audit-customer-dossier.mjs';
import { createCustomerDossierPlaybooks, createCustomerDossierDecisionDeck, createCustomerDossierEscalationMoments } from './playbooks-customer-dossier.mjs';

export function buildCustomerDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerDossierWorkspace(workspaceName);
  const policies = createCustomerDossierPolicies();
  return {
    workspace,
    summary: summarizeCustomerDossierWorkspace(workspace),
    narratives: createCustomerDossierNarratives(workspace),
    coverage: createCustomerDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerDossierPolicies(policies),
    validation: validateCustomerDossierPolicies(policies),
    escalationDeck: createCustomerDossierEscalationDeck(policies),
    analytics: {
      timeline: createCustomerDossierAnalyticsTimeline(),
      forecast: createCustomerDossierForecastEnvelope(),
      exceptions: createCustomerDossierExceptionLedger(),
      summary: summarizeCustomerDossierAnalytics()
    },
    operations: {
      board: createCustomerDossierOperationsBoard(),
      checklist: createCustomerDossierShiftChecklist(),
      incidents: createCustomerDossierIncidentDeck()
    },
    reporting: {
      cards: createCustomerDossierReportCards(),
      packets: createCustomerDossierReviewPackets(),
      summary: summarizeCustomerDossierReporting()
    },
    audit: {
      trail: createCustomerDossierAuditTrail(),
      manifest: createCustomerDossierEvidenceManifest(),
      attestation: createCustomerDossierReadinessAttestation()
    },
    playbooks: createCustomerDossierPlaybooks(),
    decisions: createCustomerDossierDecisionDeck(),
    escalationMoments: createCustomerDossierEscalationMoments()
  };
}

export function createCustomerDossierReadinessBoard(snapshot = buildCustomerDossierSnapshot()) {
  return [
    { id: 'customer-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerDossierApiDocument(snapshot = buildCustomerDossierSnapshot()) {
  return {
    id: 'customer-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-dossier/overview' },
      { method: 'GET', path: '/api/customer-dossier/reporting' },
      { method: 'POST', path: '/api/customer-dossier/validate' },
      { method: 'GET', path: '/api/customer-dossier/audit' }
    ],
    readiness: createCustomerDossierReadinessBoard(snapshot)
  };
}

export function createCustomerDossierRouteSummary(snapshot = buildCustomerDossierSnapshot()) {
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

