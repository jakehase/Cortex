import { createAnalyticsDossierWorkspace, summarizeAnalyticsDossierWorkspace, createAnalyticsDossierNarratives, createAnalyticsDossierCoverageGrid } from './domain-analytics-dossier.mjs';
import { createAnalyticsDossierPolicies, validateAnalyticsDossierPolicies, summarizeAnalyticsDossierPolicies, createAnalyticsDossierEscalationDeck } from './policies-analytics-dossier.mjs';
import { createAnalyticsDossierAnalyticsTimeline, createAnalyticsDossierForecastEnvelope, createAnalyticsDossierExceptionLedger, summarizeAnalyticsDossierAnalytics } from './analytics-analytics-dossier.mjs';
import { createAnalyticsDossierOperationsBoard, createAnalyticsDossierShiftChecklist, createAnalyticsDossierIncidentDeck } from './operations-analytics-dossier.mjs';
import { createAnalyticsDossierReportCards, createAnalyticsDossierReviewPackets, summarizeAnalyticsDossierReporting } from './reporting-analytics-dossier.mjs';
import { createAnalyticsDossierAuditTrail, createAnalyticsDossierEvidenceManifest, createAnalyticsDossierReadinessAttestation } from './audit-analytics-dossier.mjs';
import { createAnalyticsDossierPlaybooks, createAnalyticsDossierDecisionDeck, createAnalyticsDossierEscalationMoments } from './playbooks-analytics-dossier.mjs';

export function buildAnalyticsDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsDossierWorkspace(workspaceName);
  const policies = createAnalyticsDossierPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsDossierWorkspace(workspace),
    narratives: createAnalyticsDossierNarratives(workspace),
    coverage: createAnalyticsDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsDossierPolicies(policies),
    validation: validateAnalyticsDossierPolicies(policies),
    escalationDeck: createAnalyticsDossierEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsDossierAnalyticsTimeline(),
      forecast: createAnalyticsDossierForecastEnvelope(),
      exceptions: createAnalyticsDossierExceptionLedger(),
      summary: summarizeAnalyticsDossierAnalytics()
    },
    operations: {
      board: createAnalyticsDossierOperationsBoard(),
      checklist: createAnalyticsDossierShiftChecklist(),
      incidents: createAnalyticsDossierIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsDossierReportCards(),
      packets: createAnalyticsDossierReviewPackets(),
      summary: summarizeAnalyticsDossierReporting()
    },
    audit: {
      trail: createAnalyticsDossierAuditTrail(),
      manifest: createAnalyticsDossierEvidenceManifest(),
      attestation: createAnalyticsDossierReadinessAttestation()
    },
    playbooks: createAnalyticsDossierPlaybooks(),
    decisions: createAnalyticsDossierDecisionDeck(),
    escalationMoments: createAnalyticsDossierEscalationMoments()
  };
}

export function createAnalyticsDossierReadinessBoard(snapshot = buildAnalyticsDossierSnapshot()) {
  return [
    { id: 'analytics-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsDossierApiDocument(snapshot = buildAnalyticsDossierSnapshot()) {
  return {
    id: 'analytics-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-dossier/overview' },
      { method: 'GET', path: '/api/analytics-dossier/reporting' },
      { method: 'POST', path: '/api/analytics-dossier/validate' },
      { method: 'GET', path: '/api/analytics-dossier/audit' }
    ],
    readiness: createAnalyticsDossierReadinessBoard(snapshot)
  };
}

export function createAnalyticsDossierRouteSummary(snapshot = buildAnalyticsDossierSnapshot()) {
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

