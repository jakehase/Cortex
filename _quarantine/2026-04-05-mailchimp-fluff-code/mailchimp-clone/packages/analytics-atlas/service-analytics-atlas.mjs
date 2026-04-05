import { createAnalyticsAtlasWorkspace, summarizeAnalyticsAtlasWorkspace, createAnalyticsAtlasNarratives, createAnalyticsAtlasCoverageGrid } from './domain-analytics-atlas.mjs';
import { createAnalyticsAtlasPolicies, validateAnalyticsAtlasPolicies, summarizeAnalyticsAtlasPolicies, createAnalyticsAtlasEscalationDeck } from './policies-analytics-atlas.mjs';
import { createAnalyticsAtlasAnalyticsTimeline, createAnalyticsAtlasForecastEnvelope, createAnalyticsAtlasExceptionLedger, summarizeAnalyticsAtlasAnalytics } from './analytics-analytics-atlas.mjs';
import { createAnalyticsAtlasOperationsBoard, createAnalyticsAtlasShiftChecklist, createAnalyticsAtlasIncidentDeck } from './operations-analytics-atlas.mjs';
import { createAnalyticsAtlasReportCards, createAnalyticsAtlasReviewPackets, summarizeAnalyticsAtlasReporting } from './reporting-analytics-atlas.mjs';
import { createAnalyticsAtlasAuditTrail, createAnalyticsAtlasEvidenceManifest, createAnalyticsAtlasReadinessAttestation } from './audit-analytics-atlas.mjs';
import { createAnalyticsAtlasPlaybooks, createAnalyticsAtlasDecisionDeck, createAnalyticsAtlasEscalationMoments } from './playbooks-analytics-atlas.mjs';

export function buildAnalyticsAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsAtlasWorkspace(workspaceName);
  const policies = createAnalyticsAtlasPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsAtlasWorkspace(workspace),
    narratives: createAnalyticsAtlasNarratives(workspace),
    coverage: createAnalyticsAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsAtlasPolicies(policies),
    validation: validateAnalyticsAtlasPolicies(policies),
    escalationDeck: createAnalyticsAtlasEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsAtlasAnalyticsTimeline(),
      forecast: createAnalyticsAtlasForecastEnvelope(),
      exceptions: createAnalyticsAtlasExceptionLedger(),
      summary: summarizeAnalyticsAtlasAnalytics()
    },
    operations: {
      board: createAnalyticsAtlasOperationsBoard(),
      checklist: createAnalyticsAtlasShiftChecklist(),
      incidents: createAnalyticsAtlasIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsAtlasReportCards(),
      packets: createAnalyticsAtlasReviewPackets(),
      summary: summarizeAnalyticsAtlasReporting()
    },
    audit: {
      trail: createAnalyticsAtlasAuditTrail(),
      manifest: createAnalyticsAtlasEvidenceManifest(),
      attestation: createAnalyticsAtlasReadinessAttestation()
    },
    playbooks: createAnalyticsAtlasPlaybooks(),
    decisions: createAnalyticsAtlasDecisionDeck(),
    escalationMoments: createAnalyticsAtlasEscalationMoments()
  };
}

export function createAnalyticsAtlasReadinessBoard(snapshot = buildAnalyticsAtlasSnapshot()) {
  return [
    { id: 'analytics-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsAtlasApiDocument(snapshot = buildAnalyticsAtlasSnapshot()) {
  return {
    id: 'analytics-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-atlas/overview' },
      { method: 'GET', path: '/api/analytics-atlas/reporting' },
      { method: 'POST', path: '/api/analytics-atlas/validate' },
      { method: 'GET', path: '/api/analytics-atlas/audit' }
    ],
    readiness: createAnalyticsAtlasReadinessBoard(snapshot)
  };
}

export function createAnalyticsAtlasRouteSummary(snapshot = buildAnalyticsAtlasSnapshot()) {
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

