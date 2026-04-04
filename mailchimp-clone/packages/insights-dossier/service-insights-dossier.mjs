import { createInsightsDossierWorkspace, summarizeInsightsDossierWorkspace, createInsightsDossierNarratives, createInsightsDossierCoverageGrid } from './domain-insights-dossier.mjs';
import { createInsightsDossierPolicies, validateInsightsDossierPolicies, summarizeInsightsDossierPolicies, createInsightsDossierEscalationDeck } from './policies-insights-dossier.mjs';
import { createInsightsDossierAnalyticsTimeline, createInsightsDossierForecastEnvelope, createInsightsDossierExceptionLedger, summarizeInsightsDossierAnalytics } from './analytics-insights-dossier.mjs';
import { createInsightsDossierOperationsBoard, createInsightsDossierShiftChecklist, createInsightsDossierIncidentDeck } from './operations-insights-dossier.mjs';
import { createInsightsDossierReportCards, createInsightsDossierReviewPackets, summarizeInsightsDossierReporting } from './reporting-insights-dossier.mjs';
import { createInsightsDossierAuditTrail, createInsightsDossierEvidenceManifest, createInsightsDossierReadinessAttestation } from './audit-insights-dossier.mjs';
import { createInsightsDossierPlaybooks, createInsightsDossierDecisionDeck, createInsightsDossierEscalationMoments } from './playbooks-insights-dossier.mjs';

export function buildInsightsDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsDossierWorkspace(workspaceName);
  const policies = createInsightsDossierPolicies();
  return {
    workspace,
    summary: summarizeInsightsDossierWorkspace(workspace),
    narratives: createInsightsDossierNarratives(workspace),
    coverage: createInsightsDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsDossierPolicies(policies),
    validation: validateInsightsDossierPolicies(policies),
    escalationDeck: createInsightsDossierEscalationDeck(policies),
    analytics: {
      timeline: createInsightsDossierAnalyticsTimeline(),
      forecast: createInsightsDossierForecastEnvelope(),
      exceptions: createInsightsDossierExceptionLedger(),
      summary: summarizeInsightsDossierAnalytics()
    },
    operations: {
      board: createInsightsDossierOperationsBoard(),
      checklist: createInsightsDossierShiftChecklist(),
      incidents: createInsightsDossierIncidentDeck()
    },
    reporting: {
      cards: createInsightsDossierReportCards(),
      packets: createInsightsDossierReviewPackets(),
      summary: summarizeInsightsDossierReporting()
    },
    audit: {
      trail: createInsightsDossierAuditTrail(),
      manifest: createInsightsDossierEvidenceManifest(),
      attestation: createInsightsDossierReadinessAttestation()
    },
    playbooks: createInsightsDossierPlaybooks(),
    decisions: createInsightsDossierDecisionDeck(),
    escalationMoments: createInsightsDossierEscalationMoments()
  };
}

export function createInsightsDossierReadinessBoard(snapshot = buildInsightsDossierSnapshot()) {
  return [
    { id: 'insights-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsDossierApiDocument(snapshot = buildInsightsDossierSnapshot()) {
  return {
    id: 'insights-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-dossier/overview' },
      { method: 'GET', path: '/api/insights-dossier/reporting' },
      { method: 'POST', path: '/api/insights-dossier/validate' },
      { method: 'GET', path: '/api/insights-dossier/audit' }
    ],
    readiness: createInsightsDossierReadinessBoard(snapshot)
  };
}

export function createInsightsDossierRouteSummary(snapshot = buildInsightsDossierSnapshot()) {
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

