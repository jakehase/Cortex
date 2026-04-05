import { createAttributionAtlasWorkspace, summarizeAttributionAtlasWorkspace, createAttributionAtlasNarratives, createAttributionAtlasCoverageGrid } from './domain-attribution-atlas.mjs';
import { createAttributionAtlasPolicies, validateAttributionAtlasPolicies, summarizeAttributionAtlasPolicies, createAttributionAtlasEscalationDeck } from './policies-attribution-atlas.mjs';
import { createAttributionAtlasAnalyticsTimeline, createAttributionAtlasForecastEnvelope, createAttributionAtlasExceptionLedger, summarizeAttributionAtlasAnalytics } from './analytics-attribution-atlas.mjs';
import { createAttributionAtlasOperationsBoard, createAttributionAtlasShiftChecklist, createAttributionAtlasIncidentDeck } from './operations-attribution-atlas.mjs';
import { createAttributionAtlasReportCards, createAttributionAtlasReviewPackets, summarizeAttributionAtlasReporting } from './reporting-attribution-atlas.mjs';
import { createAttributionAtlasAuditTrail, createAttributionAtlasEvidenceManifest, createAttributionAtlasReadinessAttestation } from './audit-attribution-atlas.mjs';
import { createAttributionAtlasPlaybooks, createAttributionAtlasDecisionDeck, createAttributionAtlasEscalationMoments } from './playbooks-attribution-atlas.mjs';

export function buildAttributionAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionAtlasWorkspace(workspaceName);
  const policies = createAttributionAtlasPolicies();
  return {
    workspace,
    summary: summarizeAttributionAtlasWorkspace(workspace),
    narratives: createAttributionAtlasNarratives(workspace),
    coverage: createAttributionAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionAtlasPolicies(policies),
    validation: validateAttributionAtlasPolicies(policies),
    escalationDeck: createAttributionAtlasEscalationDeck(policies),
    analytics: {
      timeline: createAttributionAtlasAnalyticsTimeline(),
      forecast: createAttributionAtlasForecastEnvelope(),
      exceptions: createAttributionAtlasExceptionLedger(),
      summary: summarizeAttributionAtlasAnalytics()
    },
    operations: {
      board: createAttributionAtlasOperationsBoard(),
      checklist: createAttributionAtlasShiftChecklist(),
      incidents: createAttributionAtlasIncidentDeck()
    },
    reporting: {
      cards: createAttributionAtlasReportCards(),
      packets: createAttributionAtlasReviewPackets(),
      summary: summarizeAttributionAtlasReporting()
    },
    audit: {
      trail: createAttributionAtlasAuditTrail(),
      manifest: createAttributionAtlasEvidenceManifest(),
      attestation: createAttributionAtlasReadinessAttestation()
    },
    playbooks: createAttributionAtlasPlaybooks(),
    decisions: createAttributionAtlasDecisionDeck(),
    escalationMoments: createAttributionAtlasEscalationMoments()
  };
}

export function createAttributionAtlasReadinessBoard(snapshot = buildAttributionAtlasSnapshot()) {
  return [
    { id: 'attribution-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionAtlasApiDocument(snapshot = buildAttributionAtlasSnapshot()) {
  return {
    id: 'attribution-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-atlas/overview' },
      { method: 'GET', path: '/api/attribution-atlas/reporting' },
      { method: 'POST', path: '/api/attribution-atlas/validate' },
      { method: 'GET', path: '/api/attribution-atlas/audit' }
    ],
    readiness: createAttributionAtlasReadinessBoard(snapshot)
  };
}

export function createAttributionAtlasRouteSummary(snapshot = buildAttributionAtlasSnapshot()) {
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

