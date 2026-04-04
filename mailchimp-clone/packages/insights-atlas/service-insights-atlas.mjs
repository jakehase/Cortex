import { createInsightsAtlasWorkspace, summarizeInsightsAtlasWorkspace, createInsightsAtlasNarratives, createInsightsAtlasCoverageGrid } from './domain-insights-atlas.mjs';
import { createInsightsAtlasPolicies, validateInsightsAtlasPolicies, summarizeInsightsAtlasPolicies, createInsightsAtlasEscalationDeck } from './policies-insights-atlas.mjs';
import { createInsightsAtlasAnalyticsTimeline, createInsightsAtlasForecastEnvelope, createInsightsAtlasExceptionLedger, summarizeInsightsAtlasAnalytics } from './analytics-insights-atlas.mjs';
import { createInsightsAtlasOperationsBoard, createInsightsAtlasShiftChecklist, createInsightsAtlasIncidentDeck } from './operations-insights-atlas.mjs';
import { createInsightsAtlasReportCards, createInsightsAtlasReviewPackets, summarizeInsightsAtlasReporting } from './reporting-insights-atlas.mjs';
import { createInsightsAtlasAuditTrail, createInsightsAtlasEvidenceManifest, createInsightsAtlasReadinessAttestation } from './audit-insights-atlas.mjs';
import { createInsightsAtlasPlaybooks, createInsightsAtlasDecisionDeck, createInsightsAtlasEscalationMoments } from './playbooks-insights-atlas.mjs';

export function buildInsightsAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsAtlasWorkspace(workspaceName);
  const policies = createInsightsAtlasPolicies();
  return {
    workspace,
    summary: summarizeInsightsAtlasWorkspace(workspace),
    narratives: createInsightsAtlasNarratives(workspace),
    coverage: createInsightsAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsAtlasPolicies(policies),
    validation: validateInsightsAtlasPolicies(policies),
    escalationDeck: createInsightsAtlasEscalationDeck(policies),
    analytics: {
      timeline: createInsightsAtlasAnalyticsTimeline(),
      forecast: createInsightsAtlasForecastEnvelope(),
      exceptions: createInsightsAtlasExceptionLedger(),
      summary: summarizeInsightsAtlasAnalytics()
    },
    operations: {
      board: createInsightsAtlasOperationsBoard(),
      checklist: createInsightsAtlasShiftChecklist(),
      incidents: createInsightsAtlasIncidentDeck()
    },
    reporting: {
      cards: createInsightsAtlasReportCards(),
      packets: createInsightsAtlasReviewPackets(),
      summary: summarizeInsightsAtlasReporting()
    },
    audit: {
      trail: createInsightsAtlasAuditTrail(),
      manifest: createInsightsAtlasEvidenceManifest(),
      attestation: createInsightsAtlasReadinessAttestation()
    },
    playbooks: createInsightsAtlasPlaybooks(),
    decisions: createInsightsAtlasDecisionDeck(),
    escalationMoments: createInsightsAtlasEscalationMoments()
  };
}

export function createInsightsAtlasReadinessBoard(snapshot = buildInsightsAtlasSnapshot()) {
  return [
    { id: 'insights-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsAtlasApiDocument(snapshot = buildInsightsAtlasSnapshot()) {
  return {
    id: 'insights-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-atlas/overview' },
      { method: 'GET', path: '/api/insights-atlas/reporting' },
      { method: 'POST', path: '/api/insights-atlas/validate' },
      { method: 'GET', path: '/api/insights-atlas/audit' }
    ],
    readiness: createInsightsAtlasReadinessBoard(snapshot)
  };
}

export function createInsightsAtlasRouteSummary(snapshot = buildInsightsAtlasSnapshot()) {
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

