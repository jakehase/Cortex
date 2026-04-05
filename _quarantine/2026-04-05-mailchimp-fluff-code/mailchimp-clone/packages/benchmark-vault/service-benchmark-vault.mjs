import { createBenchmarkVaultWorkspace, summarizeBenchmarkVaultWorkspace, createBenchmarkVaultNarratives, createBenchmarkVaultCoverageGrid } from './domain-benchmark-vault.mjs';
import { createBenchmarkVaultPolicies, validateBenchmarkVaultPolicies, summarizeBenchmarkVaultPolicies, createBenchmarkVaultEscalationDeck } from './policies-benchmark-vault.mjs';
import { createBenchmarkVaultAnalyticsTimeline, createBenchmarkVaultForecastEnvelope, createBenchmarkVaultExceptionLedger, summarizeBenchmarkVaultAnalytics } from './analytics-benchmark-vault.mjs';
import { createBenchmarkVaultOperationsBoard, createBenchmarkVaultShiftChecklist, createBenchmarkVaultIncidentDeck } from './operations-benchmark-vault.mjs';
import { createBenchmarkVaultReportCards, createBenchmarkVaultReviewPackets, summarizeBenchmarkVaultReporting } from './reporting-benchmark-vault.mjs';
import { createBenchmarkVaultAuditTrail, createBenchmarkVaultEvidenceManifest, createBenchmarkVaultReadinessAttestation } from './audit-benchmark-vault.mjs';
import { createBenchmarkVaultPlaybooks, createBenchmarkVaultDecisionDeck, createBenchmarkVaultEscalationMoments } from './playbooks-benchmark-vault.mjs';

export function buildBenchmarkVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkVaultWorkspace(workspaceName);
  const policies = createBenchmarkVaultPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkVaultWorkspace(workspace),
    narratives: createBenchmarkVaultNarratives(workspace),
    coverage: createBenchmarkVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkVaultPolicies(policies),
    validation: validateBenchmarkVaultPolicies(policies),
    escalationDeck: createBenchmarkVaultEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkVaultAnalyticsTimeline(),
      forecast: createBenchmarkVaultForecastEnvelope(),
      exceptions: createBenchmarkVaultExceptionLedger(),
      summary: summarizeBenchmarkVaultAnalytics()
    },
    operations: {
      board: createBenchmarkVaultOperationsBoard(),
      checklist: createBenchmarkVaultShiftChecklist(),
      incidents: createBenchmarkVaultIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkVaultReportCards(),
      packets: createBenchmarkVaultReviewPackets(),
      summary: summarizeBenchmarkVaultReporting()
    },
    audit: {
      trail: createBenchmarkVaultAuditTrail(),
      manifest: createBenchmarkVaultEvidenceManifest(),
      attestation: createBenchmarkVaultReadinessAttestation()
    },
    playbooks: createBenchmarkVaultPlaybooks(),
    decisions: createBenchmarkVaultDecisionDeck(),
    escalationMoments: createBenchmarkVaultEscalationMoments()
  };
}

export function createBenchmarkVaultReadinessBoard(snapshot = buildBenchmarkVaultSnapshot()) {
  return [
    { id: 'benchmark-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkVaultApiDocument(snapshot = buildBenchmarkVaultSnapshot()) {
  return {
    id: 'benchmark-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-vault/overview' },
      { method: 'GET', path: '/api/benchmark-vault/reporting' },
      { method: 'POST', path: '/api/benchmark-vault/validate' },
      { method: 'GET', path: '/api/benchmark-vault/audit' }
    ],
    readiness: createBenchmarkVaultReadinessBoard(snapshot)
  };
}

export function createBenchmarkVaultRouteSummary(snapshot = buildBenchmarkVaultSnapshot()) {
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

