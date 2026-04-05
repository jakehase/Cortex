import { createDeliverabilityDossierWorkspace, summarizeDeliverabilityDossierWorkspace, createDeliverabilityDossierNarratives, createDeliverabilityDossierCoverageGrid } from './domain-deliverability-dossier.mjs';
import { createDeliverabilityDossierPolicies, validateDeliverabilityDossierPolicies, summarizeDeliverabilityDossierPolicies, createDeliverabilityDossierEscalationDeck } from './policies-deliverability-dossier.mjs';
import { createDeliverabilityDossierAnalyticsTimeline, createDeliverabilityDossierForecastEnvelope, createDeliverabilityDossierExceptionLedger, summarizeDeliverabilityDossierAnalytics } from './analytics-deliverability-dossier.mjs';
import { createDeliverabilityDossierOperationsBoard, createDeliverabilityDossierShiftChecklist, createDeliverabilityDossierIncidentDeck } from './operations-deliverability-dossier.mjs';
import { createDeliverabilityDossierReportCards, createDeliverabilityDossierReviewPackets, summarizeDeliverabilityDossierReporting } from './reporting-deliverability-dossier.mjs';
import { createDeliverabilityDossierAuditTrail, createDeliverabilityDossierEvidenceManifest, createDeliverabilityDossierReadinessAttestation } from './audit-deliverability-dossier.mjs';
import { createDeliverabilityDossierPlaybooks, createDeliverabilityDossierDecisionDeck, createDeliverabilityDossierEscalationMoments } from './playbooks-deliverability-dossier.mjs';

export function buildDeliverabilityDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityDossierWorkspace(workspaceName);
  const policies = createDeliverabilityDossierPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityDossierWorkspace(workspace),
    narratives: createDeliverabilityDossierNarratives(workspace),
    coverage: createDeliverabilityDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityDossierPolicies(policies),
    validation: validateDeliverabilityDossierPolicies(policies),
    escalationDeck: createDeliverabilityDossierEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityDossierAnalyticsTimeline(),
      forecast: createDeliverabilityDossierForecastEnvelope(),
      exceptions: createDeliverabilityDossierExceptionLedger(),
      summary: summarizeDeliverabilityDossierAnalytics()
    },
    operations: {
      board: createDeliverabilityDossierOperationsBoard(),
      checklist: createDeliverabilityDossierShiftChecklist(),
      incidents: createDeliverabilityDossierIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityDossierReportCards(),
      packets: createDeliverabilityDossierReviewPackets(),
      summary: summarizeDeliverabilityDossierReporting()
    },
    audit: {
      trail: createDeliverabilityDossierAuditTrail(),
      manifest: createDeliverabilityDossierEvidenceManifest(),
      attestation: createDeliverabilityDossierReadinessAttestation()
    },
    playbooks: createDeliverabilityDossierPlaybooks(),
    decisions: createDeliverabilityDossierDecisionDeck(),
    escalationMoments: createDeliverabilityDossierEscalationMoments()
  };
}

export function createDeliverabilityDossierReadinessBoard(snapshot = buildDeliverabilityDossierSnapshot()) {
  return [
    { id: 'deliverability-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityDossierApiDocument(snapshot = buildDeliverabilityDossierSnapshot()) {
  return {
    id: 'deliverability-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-dossier/overview' },
      { method: 'GET', path: '/api/deliverability-dossier/reporting' },
      { method: 'POST', path: '/api/deliverability-dossier/validate' },
      { method: 'GET', path: '/api/deliverability-dossier/audit' }
    ],
    readiness: createDeliverabilityDossierReadinessBoard(snapshot)
  };
}

export function createDeliverabilityDossierRouteSummary(snapshot = buildDeliverabilityDossierSnapshot()) {
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

