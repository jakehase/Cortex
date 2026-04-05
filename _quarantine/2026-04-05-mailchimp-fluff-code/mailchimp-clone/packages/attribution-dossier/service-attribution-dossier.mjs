import { createAttributionDossierWorkspace, summarizeAttributionDossierWorkspace, createAttributionDossierNarratives, createAttributionDossierCoverageGrid } from './domain-attribution-dossier.mjs';
import { createAttributionDossierPolicies, validateAttributionDossierPolicies, summarizeAttributionDossierPolicies, createAttributionDossierEscalationDeck } from './policies-attribution-dossier.mjs';
import { createAttributionDossierAnalyticsTimeline, createAttributionDossierForecastEnvelope, createAttributionDossierExceptionLedger, summarizeAttributionDossierAnalytics } from './analytics-attribution-dossier.mjs';
import { createAttributionDossierOperationsBoard, createAttributionDossierShiftChecklist, createAttributionDossierIncidentDeck } from './operations-attribution-dossier.mjs';
import { createAttributionDossierReportCards, createAttributionDossierReviewPackets, summarizeAttributionDossierReporting } from './reporting-attribution-dossier.mjs';
import { createAttributionDossierAuditTrail, createAttributionDossierEvidenceManifest, createAttributionDossierReadinessAttestation } from './audit-attribution-dossier.mjs';
import { createAttributionDossierPlaybooks, createAttributionDossierDecisionDeck, createAttributionDossierEscalationMoments } from './playbooks-attribution-dossier.mjs';

export function buildAttributionDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionDossierWorkspace(workspaceName);
  const policies = createAttributionDossierPolicies();
  return {
    workspace,
    summary: summarizeAttributionDossierWorkspace(workspace),
    narratives: createAttributionDossierNarratives(workspace),
    coverage: createAttributionDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionDossierPolicies(policies),
    validation: validateAttributionDossierPolicies(policies),
    escalationDeck: createAttributionDossierEscalationDeck(policies),
    analytics: {
      timeline: createAttributionDossierAnalyticsTimeline(),
      forecast: createAttributionDossierForecastEnvelope(),
      exceptions: createAttributionDossierExceptionLedger(),
      summary: summarizeAttributionDossierAnalytics()
    },
    operations: {
      board: createAttributionDossierOperationsBoard(),
      checklist: createAttributionDossierShiftChecklist(),
      incidents: createAttributionDossierIncidentDeck()
    },
    reporting: {
      cards: createAttributionDossierReportCards(),
      packets: createAttributionDossierReviewPackets(),
      summary: summarizeAttributionDossierReporting()
    },
    audit: {
      trail: createAttributionDossierAuditTrail(),
      manifest: createAttributionDossierEvidenceManifest(),
      attestation: createAttributionDossierReadinessAttestation()
    },
    playbooks: createAttributionDossierPlaybooks(),
    decisions: createAttributionDossierDecisionDeck(),
    escalationMoments: createAttributionDossierEscalationMoments()
  };
}

export function createAttributionDossierReadinessBoard(snapshot = buildAttributionDossierSnapshot()) {
  return [
    { id: 'attribution-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionDossierApiDocument(snapshot = buildAttributionDossierSnapshot()) {
  return {
    id: 'attribution-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-dossier/overview' },
      { method: 'GET', path: '/api/attribution-dossier/reporting' },
      { method: 'POST', path: '/api/attribution-dossier/validate' },
      { method: 'GET', path: '/api/attribution-dossier/audit' }
    ],
    readiness: createAttributionDossierReadinessBoard(snapshot)
  };
}

export function createAttributionDossierRouteSummary(snapshot = buildAttributionDossierSnapshot()) {
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

