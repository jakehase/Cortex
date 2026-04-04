import { createCollaborationAtlasWorkspace, summarizeCollaborationAtlasWorkspace, createCollaborationAtlasNarratives, createCollaborationAtlasCoverageGrid } from './domain-collaboration-atlas.mjs';
import { createCollaborationAtlasPolicies, validateCollaborationAtlasPolicies, summarizeCollaborationAtlasPolicies, createCollaborationAtlasEscalationDeck } from './policies-collaboration-atlas.mjs';
import { createCollaborationAtlasAnalyticsTimeline, createCollaborationAtlasForecastEnvelope, createCollaborationAtlasExceptionLedger, summarizeCollaborationAtlasAnalytics } from './analytics-collaboration-atlas.mjs';
import { createCollaborationAtlasOperationsBoard, createCollaborationAtlasShiftChecklist, createCollaborationAtlasIncidentDeck } from './operations-collaboration-atlas.mjs';
import { createCollaborationAtlasReportCards, createCollaborationAtlasReviewPackets, summarizeCollaborationAtlasReporting } from './reporting-collaboration-atlas.mjs';
import { createCollaborationAtlasAuditTrail, createCollaborationAtlasEvidenceManifest, createCollaborationAtlasReadinessAttestation } from './audit-collaboration-atlas.mjs';
import { createCollaborationAtlasPlaybooks, createCollaborationAtlasDecisionDeck, createCollaborationAtlasEscalationMoments } from './playbooks-collaboration-atlas.mjs';

export function buildCollaborationAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationAtlasWorkspace(workspaceName);
  const policies = createCollaborationAtlasPolicies();
  return {
    workspace,
    summary: summarizeCollaborationAtlasWorkspace(workspace),
    narratives: createCollaborationAtlasNarratives(workspace),
    coverage: createCollaborationAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationAtlasPolicies(policies),
    validation: validateCollaborationAtlasPolicies(policies),
    escalationDeck: createCollaborationAtlasEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationAtlasAnalyticsTimeline(),
      forecast: createCollaborationAtlasForecastEnvelope(),
      exceptions: createCollaborationAtlasExceptionLedger(),
      summary: summarizeCollaborationAtlasAnalytics()
    },
    operations: {
      board: createCollaborationAtlasOperationsBoard(),
      checklist: createCollaborationAtlasShiftChecklist(),
      incidents: createCollaborationAtlasIncidentDeck()
    },
    reporting: {
      cards: createCollaborationAtlasReportCards(),
      packets: createCollaborationAtlasReviewPackets(),
      summary: summarizeCollaborationAtlasReporting()
    },
    audit: {
      trail: createCollaborationAtlasAuditTrail(),
      manifest: createCollaborationAtlasEvidenceManifest(),
      attestation: createCollaborationAtlasReadinessAttestation()
    },
    playbooks: createCollaborationAtlasPlaybooks(),
    decisions: createCollaborationAtlasDecisionDeck(),
    escalationMoments: createCollaborationAtlasEscalationMoments()
  };
}

export function createCollaborationAtlasReadinessBoard(snapshot = buildCollaborationAtlasSnapshot()) {
  return [
    { id: 'collaboration-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationAtlasApiDocument(snapshot = buildCollaborationAtlasSnapshot()) {
  return {
    id: 'collaboration-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-atlas/overview' },
      { method: 'GET', path: '/api/collaboration-atlas/reporting' },
      { method: 'POST', path: '/api/collaboration-atlas/validate' },
      { method: 'GET', path: '/api/collaboration-atlas/audit' }
    ],
    readiness: createCollaborationAtlasReadinessBoard(snapshot)
  };
}

export function createCollaborationAtlasRouteSummary(snapshot = buildCollaborationAtlasSnapshot()) {
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

