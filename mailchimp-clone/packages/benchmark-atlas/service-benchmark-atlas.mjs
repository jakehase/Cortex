import { createBenchmarkAtlasWorkspace, summarizeBenchmarkAtlasWorkspace, createBenchmarkAtlasNarratives, createBenchmarkAtlasCoverageGrid } from './domain-benchmark-atlas.mjs';
import { createBenchmarkAtlasPolicies, validateBenchmarkAtlasPolicies, summarizeBenchmarkAtlasPolicies, createBenchmarkAtlasEscalationDeck } from './policies-benchmark-atlas.mjs';
import { createBenchmarkAtlasAnalyticsTimeline, createBenchmarkAtlasForecastEnvelope, createBenchmarkAtlasExceptionLedger, summarizeBenchmarkAtlasAnalytics } from './analytics-benchmark-atlas.mjs';
import { createBenchmarkAtlasOperationsBoard, createBenchmarkAtlasShiftChecklist, createBenchmarkAtlasIncidentDeck } from './operations-benchmark-atlas.mjs';
import { createBenchmarkAtlasReportCards, createBenchmarkAtlasReviewPackets, summarizeBenchmarkAtlasReporting } from './reporting-benchmark-atlas.mjs';
import { createBenchmarkAtlasAuditTrail, createBenchmarkAtlasEvidenceManifest, createBenchmarkAtlasReadinessAttestation } from './audit-benchmark-atlas.mjs';
import { createBenchmarkAtlasPlaybooks, createBenchmarkAtlasDecisionDeck, createBenchmarkAtlasEscalationMoments } from './playbooks-benchmark-atlas.mjs';

export function buildBenchmarkAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkAtlasWorkspace(workspaceName);
  const policies = createBenchmarkAtlasPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkAtlasWorkspace(workspace),
    narratives: createBenchmarkAtlasNarratives(workspace),
    coverage: createBenchmarkAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkAtlasPolicies(policies),
    validation: validateBenchmarkAtlasPolicies(policies),
    escalationDeck: createBenchmarkAtlasEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkAtlasAnalyticsTimeline(),
      forecast: createBenchmarkAtlasForecastEnvelope(),
      exceptions: createBenchmarkAtlasExceptionLedger(),
      summary: summarizeBenchmarkAtlasAnalytics()
    },
    operations: {
      board: createBenchmarkAtlasOperationsBoard(),
      checklist: createBenchmarkAtlasShiftChecklist(),
      incidents: createBenchmarkAtlasIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkAtlasReportCards(),
      packets: createBenchmarkAtlasReviewPackets(),
      summary: summarizeBenchmarkAtlasReporting()
    },
    audit: {
      trail: createBenchmarkAtlasAuditTrail(),
      manifest: createBenchmarkAtlasEvidenceManifest(),
      attestation: createBenchmarkAtlasReadinessAttestation()
    },
    playbooks: createBenchmarkAtlasPlaybooks(),
    decisions: createBenchmarkAtlasDecisionDeck(),
    escalationMoments: createBenchmarkAtlasEscalationMoments()
  };
}

export function createBenchmarkAtlasReadinessBoard(snapshot = buildBenchmarkAtlasSnapshot()) {
  return [
    { id: 'benchmark-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkAtlasApiDocument(snapshot = buildBenchmarkAtlasSnapshot()) {
  return {
    id: 'benchmark-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-atlas/overview' },
      { method: 'GET', path: '/api/benchmark-atlas/reporting' },
      { method: 'POST', path: '/api/benchmark-atlas/validate' },
      { method: 'GET', path: '/api/benchmark-atlas/audit' }
    ],
    readiness: createBenchmarkAtlasReadinessBoard(snapshot)
  };
}

export function createBenchmarkAtlasRouteSummary(snapshot = buildBenchmarkAtlasSnapshot()) {
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

