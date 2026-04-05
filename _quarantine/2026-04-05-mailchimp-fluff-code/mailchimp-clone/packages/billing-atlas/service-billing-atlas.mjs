import { createBillingAtlasWorkspace, summarizeBillingAtlasWorkspace, createBillingAtlasNarratives, createBillingAtlasCoverageGrid } from './domain-billing-atlas.mjs';
import { createBillingAtlasPolicies, validateBillingAtlasPolicies, summarizeBillingAtlasPolicies, createBillingAtlasEscalationDeck } from './policies-billing-atlas.mjs';
import { createBillingAtlasAnalyticsTimeline, createBillingAtlasForecastEnvelope, createBillingAtlasExceptionLedger, summarizeBillingAtlasAnalytics } from './analytics-billing-atlas.mjs';
import { createBillingAtlasOperationsBoard, createBillingAtlasShiftChecklist, createBillingAtlasIncidentDeck } from './operations-billing-atlas.mjs';
import { createBillingAtlasReportCards, createBillingAtlasReviewPackets, summarizeBillingAtlasReporting } from './reporting-billing-atlas.mjs';
import { createBillingAtlasAuditTrail, createBillingAtlasEvidenceManifest, createBillingAtlasReadinessAttestation } from './audit-billing-atlas.mjs';
import { createBillingAtlasPlaybooks, createBillingAtlasDecisionDeck, createBillingAtlasEscalationMoments } from './playbooks-billing-atlas.mjs';

export function buildBillingAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingAtlasWorkspace(workspaceName);
  const policies = createBillingAtlasPolicies();
  return {
    workspace,
    summary: summarizeBillingAtlasWorkspace(workspace),
    narratives: createBillingAtlasNarratives(workspace),
    coverage: createBillingAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingAtlasPolicies(policies),
    validation: validateBillingAtlasPolicies(policies),
    escalationDeck: createBillingAtlasEscalationDeck(policies),
    analytics: {
      timeline: createBillingAtlasAnalyticsTimeline(),
      forecast: createBillingAtlasForecastEnvelope(),
      exceptions: createBillingAtlasExceptionLedger(),
      summary: summarizeBillingAtlasAnalytics()
    },
    operations: {
      board: createBillingAtlasOperationsBoard(),
      checklist: createBillingAtlasShiftChecklist(),
      incidents: createBillingAtlasIncidentDeck()
    },
    reporting: {
      cards: createBillingAtlasReportCards(),
      packets: createBillingAtlasReviewPackets(),
      summary: summarizeBillingAtlasReporting()
    },
    audit: {
      trail: createBillingAtlasAuditTrail(),
      manifest: createBillingAtlasEvidenceManifest(),
      attestation: createBillingAtlasReadinessAttestation()
    },
    playbooks: createBillingAtlasPlaybooks(),
    decisions: createBillingAtlasDecisionDeck(),
    escalationMoments: createBillingAtlasEscalationMoments()
  };
}

export function createBillingAtlasReadinessBoard(snapshot = buildBillingAtlasSnapshot()) {
  return [
    { id: 'billing-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingAtlasApiDocument(snapshot = buildBillingAtlasSnapshot()) {
  return {
    id: 'billing-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-atlas/overview' },
      { method: 'GET', path: '/api/billing-atlas/reporting' },
      { method: 'POST', path: '/api/billing-atlas/validate' },
      { method: 'GET', path: '/api/billing-atlas/audit' }
    ],
    readiness: createBillingAtlasReadinessBoard(snapshot)
  };
}

export function createBillingAtlasRouteSummary(snapshot = buildBillingAtlasSnapshot()) {
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

