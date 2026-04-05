import { createLifecycleAtlasWorkspace, summarizeLifecycleAtlasWorkspace, createLifecycleAtlasNarratives, createLifecycleAtlasCoverageGrid } from './domain-lifecycle-atlas.mjs';
import { createLifecycleAtlasPolicies, validateLifecycleAtlasPolicies, summarizeLifecycleAtlasPolicies, createLifecycleAtlasEscalationDeck } from './policies-lifecycle-atlas.mjs';
import { createLifecycleAtlasAnalyticsTimeline, createLifecycleAtlasForecastEnvelope, createLifecycleAtlasExceptionLedger, summarizeLifecycleAtlasAnalytics } from './analytics-lifecycle-atlas.mjs';
import { createLifecycleAtlasOperationsBoard, createLifecycleAtlasShiftChecklist, createLifecycleAtlasIncidentDeck } from './operations-lifecycle-atlas.mjs';
import { createLifecycleAtlasReportCards, createLifecycleAtlasReviewPackets, summarizeLifecycleAtlasReporting } from './reporting-lifecycle-atlas.mjs';
import { createLifecycleAtlasAuditTrail, createLifecycleAtlasEvidenceManifest, createLifecycleAtlasReadinessAttestation } from './audit-lifecycle-atlas.mjs';
import { createLifecycleAtlasPlaybooks, createLifecycleAtlasDecisionDeck, createLifecycleAtlasEscalationMoments } from './playbooks-lifecycle-atlas.mjs';

export function buildLifecycleAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleAtlasWorkspace(workspaceName);
  const policies = createLifecycleAtlasPolicies();
  return {
    workspace,
    summary: summarizeLifecycleAtlasWorkspace(workspace),
    narratives: createLifecycleAtlasNarratives(workspace),
    coverage: createLifecycleAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleAtlasPolicies(policies),
    validation: validateLifecycleAtlasPolicies(policies),
    escalationDeck: createLifecycleAtlasEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleAtlasAnalyticsTimeline(),
      forecast: createLifecycleAtlasForecastEnvelope(),
      exceptions: createLifecycleAtlasExceptionLedger(),
      summary: summarizeLifecycleAtlasAnalytics()
    },
    operations: {
      board: createLifecycleAtlasOperationsBoard(),
      checklist: createLifecycleAtlasShiftChecklist(),
      incidents: createLifecycleAtlasIncidentDeck()
    },
    reporting: {
      cards: createLifecycleAtlasReportCards(),
      packets: createLifecycleAtlasReviewPackets(),
      summary: summarizeLifecycleAtlasReporting()
    },
    audit: {
      trail: createLifecycleAtlasAuditTrail(),
      manifest: createLifecycleAtlasEvidenceManifest(),
      attestation: createLifecycleAtlasReadinessAttestation()
    },
    playbooks: createLifecycleAtlasPlaybooks(),
    decisions: createLifecycleAtlasDecisionDeck(),
    escalationMoments: createLifecycleAtlasEscalationMoments()
  };
}

export function createLifecycleAtlasReadinessBoard(snapshot = buildLifecycleAtlasSnapshot()) {
  return [
    { id: 'lifecycle-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleAtlasApiDocument(snapshot = buildLifecycleAtlasSnapshot()) {
  return {
    id: 'lifecycle-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-atlas/overview' },
      { method: 'GET', path: '/api/lifecycle-atlas/reporting' },
      { method: 'POST', path: '/api/lifecycle-atlas/validate' },
      { method: 'GET', path: '/api/lifecycle-atlas/audit' }
    ],
    readiness: createLifecycleAtlasReadinessBoard(snapshot)
  };
}

export function createLifecycleAtlasRouteSummary(snapshot = buildLifecycleAtlasSnapshot()) {
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

