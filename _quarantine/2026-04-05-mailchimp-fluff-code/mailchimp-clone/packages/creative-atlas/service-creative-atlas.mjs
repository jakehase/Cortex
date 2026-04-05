import { createCreativeAtlasWorkspace, summarizeCreativeAtlasWorkspace, createCreativeAtlasNarratives, createCreativeAtlasCoverageGrid } from './domain-creative-atlas.mjs';
import { createCreativeAtlasPolicies, validateCreativeAtlasPolicies, summarizeCreativeAtlasPolicies, createCreativeAtlasEscalationDeck } from './policies-creative-atlas.mjs';
import { createCreativeAtlasAnalyticsTimeline, createCreativeAtlasForecastEnvelope, createCreativeAtlasExceptionLedger, summarizeCreativeAtlasAnalytics } from './analytics-creative-atlas.mjs';
import { createCreativeAtlasOperationsBoard, createCreativeAtlasShiftChecklist, createCreativeAtlasIncidentDeck } from './operations-creative-atlas.mjs';
import { createCreativeAtlasReportCards, createCreativeAtlasReviewPackets, summarizeCreativeAtlasReporting } from './reporting-creative-atlas.mjs';
import { createCreativeAtlasAuditTrail, createCreativeAtlasEvidenceManifest, createCreativeAtlasReadinessAttestation } from './audit-creative-atlas.mjs';
import { createCreativeAtlasPlaybooks, createCreativeAtlasDecisionDeck, createCreativeAtlasEscalationMoments } from './playbooks-creative-atlas.mjs';

export function buildCreativeAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeAtlasWorkspace(workspaceName);
  const policies = createCreativeAtlasPolicies();
  return {
    workspace,
    summary: summarizeCreativeAtlasWorkspace(workspace),
    narratives: createCreativeAtlasNarratives(workspace),
    coverage: createCreativeAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeAtlasPolicies(policies),
    validation: validateCreativeAtlasPolicies(policies),
    escalationDeck: createCreativeAtlasEscalationDeck(policies),
    analytics: {
      timeline: createCreativeAtlasAnalyticsTimeline(),
      forecast: createCreativeAtlasForecastEnvelope(),
      exceptions: createCreativeAtlasExceptionLedger(),
      summary: summarizeCreativeAtlasAnalytics()
    },
    operations: {
      board: createCreativeAtlasOperationsBoard(),
      checklist: createCreativeAtlasShiftChecklist(),
      incidents: createCreativeAtlasIncidentDeck()
    },
    reporting: {
      cards: createCreativeAtlasReportCards(),
      packets: createCreativeAtlasReviewPackets(),
      summary: summarizeCreativeAtlasReporting()
    },
    audit: {
      trail: createCreativeAtlasAuditTrail(),
      manifest: createCreativeAtlasEvidenceManifest(),
      attestation: createCreativeAtlasReadinessAttestation()
    },
    playbooks: createCreativeAtlasPlaybooks(),
    decisions: createCreativeAtlasDecisionDeck(),
    escalationMoments: createCreativeAtlasEscalationMoments()
  };
}

export function createCreativeAtlasReadinessBoard(snapshot = buildCreativeAtlasSnapshot()) {
  return [
    { id: 'creative-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeAtlasApiDocument(snapshot = buildCreativeAtlasSnapshot()) {
  return {
    id: 'creative-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-atlas/overview' },
      { method: 'GET', path: '/api/creative-atlas/reporting' },
      { method: 'POST', path: '/api/creative-atlas/validate' },
      { method: 'GET', path: '/api/creative-atlas/audit' }
    ],
    readiness: createCreativeAtlasReadinessBoard(snapshot)
  };
}

export function createCreativeAtlasRouteSummary(snapshot = buildCreativeAtlasSnapshot()) {
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

