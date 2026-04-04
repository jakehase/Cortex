import { createCommerceDossierWorkspace, summarizeCommerceDossierWorkspace, createCommerceDossierNarratives, createCommerceDossierCoverageGrid } from './domain-commerce-dossier.mjs';
import { createCommerceDossierPolicies, validateCommerceDossierPolicies, summarizeCommerceDossierPolicies, createCommerceDossierEscalationDeck } from './policies-commerce-dossier.mjs';
import { createCommerceDossierAnalyticsTimeline, createCommerceDossierForecastEnvelope, createCommerceDossierExceptionLedger, summarizeCommerceDossierAnalytics } from './analytics-commerce-dossier.mjs';
import { createCommerceDossierOperationsBoard, createCommerceDossierShiftChecklist, createCommerceDossierIncidentDeck } from './operations-commerce-dossier.mjs';
import { createCommerceDossierReportCards, createCommerceDossierReviewPackets, summarizeCommerceDossierReporting } from './reporting-commerce-dossier.mjs';
import { createCommerceDossierAuditTrail, createCommerceDossierEvidenceManifest, createCommerceDossierReadinessAttestation } from './audit-commerce-dossier.mjs';
import { createCommerceDossierPlaybooks, createCommerceDossierDecisionDeck, createCommerceDossierEscalationMoments } from './playbooks-commerce-dossier.mjs';

export function buildCommerceDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceDossierWorkspace(workspaceName);
  const policies = createCommerceDossierPolicies();
  return {
    workspace,
    summary: summarizeCommerceDossierWorkspace(workspace),
    narratives: createCommerceDossierNarratives(workspace),
    coverage: createCommerceDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceDossierPolicies(policies),
    validation: validateCommerceDossierPolicies(policies),
    escalationDeck: createCommerceDossierEscalationDeck(policies),
    analytics: {
      timeline: createCommerceDossierAnalyticsTimeline(),
      forecast: createCommerceDossierForecastEnvelope(),
      exceptions: createCommerceDossierExceptionLedger(),
      summary: summarizeCommerceDossierAnalytics()
    },
    operations: {
      board: createCommerceDossierOperationsBoard(),
      checklist: createCommerceDossierShiftChecklist(),
      incidents: createCommerceDossierIncidentDeck()
    },
    reporting: {
      cards: createCommerceDossierReportCards(),
      packets: createCommerceDossierReviewPackets(),
      summary: summarizeCommerceDossierReporting()
    },
    audit: {
      trail: createCommerceDossierAuditTrail(),
      manifest: createCommerceDossierEvidenceManifest(),
      attestation: createCommerceDossierReadinessAttestation()
    },
    playbooks: createCommerceDossierPlaybooks(),
    decisions: createCommerceDossierDecisionDeck(),
    escalationMoments: createCommerceDossierEscalationMoments()
  };
}

export function createCommerceDossierReadinessBoard(snapshot = buildCommerceDossierSnapshot()) {
  return [
    { id: 'commerce-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceDossierApiDocument(snapshot = buildCommerceDossierSnapshot()) {
  return {
    id: 'commerce-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-dossier/overview' },
      { method: 'GET', path: '/api/commerce-dossier/reporting' },
      { method: 'POST', path: '/api/commerce-dossier/validate' },
      { method: 'GET', path: '/api/commerce-dossier/audit' }
    ],
    readiness: createCommerceDossierReadinessBoard(snapshot)
  };
}

export function createCommerceDossierRouteSummary(snapshot = buildCommerceDossierSnapshot()) {
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

