import { createContentAtlasWorkspace, summarizeContentAtlasWorkspace, createContentAtlasNarratives, createContentAtlasCoverageGrid } from './domain-content-atlas.mjs';
import { createContentAtlasPolicies, validateContentAtlasPolicies, summarizeContentAtlasPolicies, createContentAtlasEscalationDeck } from './policies-content-atlas.mjs';
import { createContentAtlasAnalyticsTimeline, createContentAtlasForecastEnvelope, createContentAtlasExceptionLedger, summarizeContentAtlasAnalytics } from './analytics-content-atlas.mjs';
import { createContentAtlasOperationsBoard, createContentAtlasShiftChecklist, createContentAtlasIncidentDeck } from './operations-content-atlas.mjs';
import { createContentAtlasReportCards, createContentAtlasReviewPackets, summarizeContentAtlasReporting } from './reporting-content-atlas.mjs';
import { createContentAtlasAuditTrail, createContentAtlasEvidenceManifest, createContentAtlasReadinessAttestation } from './audit-content-atlas.mjs';
import { createContentAtlasPlaybooks, createContentAtlasDecisionDeck, createContentAtlasEscalationMoments } from './playbooks-content-atlas.mjs';

export function buildContentAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentAtlasWorkspace(workspaceName);
  const policies = createContentAtlasPolicies();
  return {
    workspace,
    summary: summarizeContentAtlasWorkspace(workspace),
    narratives: createContentAtlasNarratives(workspace),
    coverage: createContentAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentAtlasPolicies(policies),
    validation: validateContentAtlasPolicies(policies),
    escalationDeck: createContentAtlasEscalationDeck(policies),
    analytics: {
      timeline: createContentAtlasAnalyticsTimeline(),
      forecast: createContentAtlasForecastEnvelope(),
      exceptions: createContentAtlasExceptionLedger(),
      summary: summarizeContentAtlasAnalytics()
    },
    operations: {
      board: createContentAtlasOperationsBoard(),
      checklist: createContentAtlasShiftChecklist(),
      incidents: createContentAtlasIncidentDeck()
    },
    reporting: {
      cards: createContentAtlasReportCards(),
      packets: createContentAtlasReviewPackets(),
      summary: summarizeContentAtlasReporting()
    },
    audit: {
      trail: createContentAtlasAuditTrail(),
      manifest: createContentAtlasEvidenceManifest(),
      attestation: createContentAtlasReadinessAttestation()
    },
    playbooks: createContentAtlasPlaybooks(),
    decisions: createContentAtlasDecisionDeck(),
    escalationMoments: createContentAtlasEscalationMoments()
  };
}

export function createContentAtlasReadinessBoard(snapshot = buildContentAtlasSnapshot()) {
  return [
    { id: 'content-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentAtlasApiDocument(snapshot = buildContentAtlasSnapshot()) {
  return {
    id: 'content-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-atlas/overview' },
      { method: 'GET', path: '/api/content-atlas/reporting' },
      { method: 'POST', path: '/api/content-atlas/validate' },
      { method: 'GET', path: '/api/content-atlas/audit' }
    ],
    readiness: createContentAtlasReadinessBoard(snapshot)
  };
}

export function createContentAtlasRouteSummary(snapshot = buildContentAtlasSnapshot()) {
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

