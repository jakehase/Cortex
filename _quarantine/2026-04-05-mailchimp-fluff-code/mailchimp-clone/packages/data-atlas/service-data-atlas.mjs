import { createDataAtlasWorkspace, summarizeDataAtlasWorkspace, createDataAtlasNarratives, createDataAtlasCoverageGrid } from './domain-data-atlas.mjs';
import { createDataAtlasPolicies, validateDataAtlasPolicies, summarizeDataAtlasPolicies, createDataAtlasEscalationDeck } from './policies-data-atlas.mjs';
import { createDataAtlasAnalyticsTimeline, createDataAtlasForecastEnvelope, createDataAtlasExceptionLedger, summarizeDataAtlasAnalytics } from './analytics-data-atlas.mjs';
import { createDataAtlasOperationsBoard, createDataAtlasShiftChecklist, createDataAtlasIncidentDeck } from './operations-data-atlas.mjs';
import { createDataAtlasReportCards, createDataAtlasReviewPackets, summarizeDataAtlasReporting } from './reporting-data-atlas.mjs';
import { createDataAtlasAuditTrail, createDataAtlasEvidenceManifest, createDataAtlasReadinessAttestation } from './audit-data-atlas.mjs';
import { createDataAtlasPlaybooks, createDataAtlasDecisionDeck, createDataAtlasEscalationMoments } from './playbooks-data-atlas.mjs';

export function buildDataAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataAtlasWorkspace(workspaceName);
  const policies = createDataAtlasPolicies();
  return {
    workspace,
    summary: summarizeDataAtlasWorkspace(workspace),
    narratives: createDataAtlasNarratives(workspace),
    coverage: createDataAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataAtlasPolicies(policies),
    validation: validateDataAtlasPolicies(policies),
    escalationDeck: createDataAtlasEscalationDeck(policies),
    analytics: {
      timeline: createDataAtlasAnalyticsTimeline(),
      forecast: createDataAtlasForecastEnvelope(),
      exceptions: createDataAtlasExceptionLedger(),
      summary: summarizeDataAtlasAnalytics()
    },
    operations: {
      board: createDataAtlasOperationsBoard(),
      checklist: createDataAtlasShiftChecklist(),
      incidents: createDataAtlasIncidentDeck()
    },
    reporting: {
      cards: createDataAtlasReportCards(),
      packets: createDataAtlasReviewPackets(),
      summary: summarizeDataAtlasReporting()
    },
    audit: {
      trail: createDataAtlasAuditTrail(),
      manifest: createDataAtlasEvidenceManifest(),
      attestation: createDataAtlasReadinessAttestation()
    },
    playbooks: createDataAtlasPlaybooks(),
    decisions: createDataAtlasDecisionDeck(),
    escalationMoments: createDataAtlasEscalationMoments()
  };
}

export function createDataAtlasReadinessBoard(snapshot = buildDataAtlasSnapshot()) {
  return [
    { id: 'data-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataAtlasApiDocument(snapshot = buildDataAtlasSnapshot()) {
  return {
    id: 'data-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-atlas/overview' },
      { method: 'GET', path: '/api/data-atlas/reporting' },
      { method: 'POST', path: '/api/data-atlas/validate' },
      { method: 'GET', path: '/api/data-atlas/audit' }
    ],
    readiness: createDataAtlasReadinessBoard(snapshot)
  };
}

export function createDataAtlasRouteSummary(snapshot = buildDataAtlasSnapshot()) {
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

