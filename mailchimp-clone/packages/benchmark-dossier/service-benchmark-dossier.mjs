import { createBenchmarkDossierWorkspace, summarizeBenchmarkDossierWorkspace, createBenchmarkDossierNarratives, createBenchmarkDossierCoverageGrid } from './domain-benchmark-dossier.mjs';
import { createBenchmarkDossierPolicies, validateBenchmarkDossierPolicies, summarizeBenchmarkDossierPolicies, createBenchmarkDossierEscalationDeck } from './policies-benchmark-dossier.mjs';
import { createBenchmarkDossierAnalyticsTimeline, createBenchmarkDossierForecastEnvelope, createBenchmarkDossierExceptionLedger, summarizeBenchmarkDossierAnalytics } from './analytics-benchmark-dossier.mjs';
import { createBenchmarkDossierOperationsBoard, createBenchmarkDossierShiftChecklist, createBenchmarkDossierIncidentDeck } from './operations-benchmark-dossier.mjs';
import { createBenchmarkDossierReportCards, createBenchmarkDossierReviewPackets, summarizeBenchmarkDossierReporting } from './reporting-benchmark-dossier.mjs';
import { createBenchmarkDossierAuditTrail, createBenchmarkDossierEvidenceManifest, createBenchmarkDossierReadinessAttestation } from './audit-benchmark-dossier.mjs';
import { createBenchmarkDossierPlaybooks, createBenchmarkDossierDecisionDeck, createBenchmarkDossierEscalationMoments } from './playbooks-benchmark-dossier.mjs';

export function buildBenchmarkDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkDossierWorkspace(workspaceName);
  const policies = createBenchmarkDossierPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkDossierWorkspace(workspace),
    narratives: createBenchmarkDossierNarratives(workspace),
    coverage: createBenchmarkDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkDossierPolicies(policies),
    validation: validateBenchmarkDossierPolicies(policies),
    escalationDeck: createBenchmarkDossierEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkDossierAnalyticsTimeline(),
      forecast: createBenchmarkDossierForecastEnvelope(),
      exceptions: createBenchmarkDossierExceptionLedger(),
      summary: summarizeBenchmarkDossierAnalytics()
    },
    operations: {
      board: createBenchmarkDossierOperationsBoard(),
      checklist: createBenchmarkDossierShiftChecklist(),
      incidents: createBenchmarkDossierIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkDossierReportCards(),
      packets: createBenchmarkDossierReviewPackets(),
      summary: summarizeBenchmarkDossierReporting()
    },
    audit: {
      trail: createBenchmarkDossierAuditTrail(),
      manifest: createBenchmarkDossierEvidenceManifest(),
      attestation: createBenchmarkDossierReadinessAttestation()
    },
    playbooks: createBenchmarkDossierPlaybooks(),
    decisions: createBenchmarkDossierDecisionDeck(),
    escalationMoments: createBenchmarkDossierEscalationMoments()
  };
}

export function createBenchmarkDossierReadinessBoard(snapshot = buildBenchmarkDossierSnapshot()) {
  return [
    { id: 'benchmark-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkDossierApiDocument(snapshot = buildBenchmarkDossierSnapshot()) {
  return {
    id: 'benchmark-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-dossier/overview' },
      { method: 'GET', path: '/api/benchmark-dossier/reporting' },
      { method: 'POST', path: '/api/benchmark-dossier/validate' },
      { method: 'GET', path: '/api/benchmark-dossier/audit' }
    ],
    readiness: createBenchmarkDossierReadinessBoard(snapshot)
  };
}

export function createBenchmarkDossierRouteSummary(snapshot = buildBenchmarkDossierSnapshot()) {
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

