import { createCommerceAtlasWorkspace, summarizeCommerceAtlasWorkspace, createCommerceAtlasNarratives, createCommerceAtlasCoverageGrid } from './domain-commerce-atlas.mjs';
import { createCommerceAtlasPolicies, validateCommerceAtlasPolicies, summarizeCommerceAtlasPolicies, createCommerceAtlasEscalationDeck } from './policies-commerce-atlas.mjs';
import { createCommerceAtlasAnalyticsTimeline, createCommerceAtlasForecastEnvelope, createCommerceAtlasExceptionLedger, summarizeCommerceAtlasAnalytics } from './analytics-commerce-atlas.mjs';
import { createCommerceAtlasOperationsBoard, createCommerceAtlasShiftChecklist, createCommerceAtlasIncidentDeck } from './operations-commerce-atlas.mjs';
import { createCommerceAtlasReportCards, createCommerceAtlasReviewPackets, summarizeCommerceAtlasReporting } from './reporting-commerce-atlas.mjs';
import { createCommerceAtlasAuditTrail, createCommerceAtlasEvidenceManifest, createCommerceAtlasReadinessAttestation } from './audit-commerce-atlas.mjs';
import { createCommerceAtlasPlaybooks, createCommerceAtlasDecisionDeck, createCommerceAtlasEscalationMoments } from './playbooks-commerce-atlas.mjs';

export function buildCommerceAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceAtlasWorkspace(workspaceName);
  const policies = createCommerceAtlasPolicies();
  return {
    workspace,
    summary: summarizeCommerceAtlasWorkspace(workspace),
    narratives: createCommerceAtlasNarratives(workspace),
    coverage: createCommerceAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceAtlasPolicies(policies),
    validation: validateCommerceAtlasPolicies(policies),
    escalationDeck: createCommerceAtlasEscalationDeck(policies),
    analytics: {
      timeline: createCommerceAtlasAnalyticsTimeline(),
      forecast: createCommerceAtlasForecastEnvelope(),
      exceptions: createCommerceAtlasExceptionLedger(),
      summary: summarizeCommerceAtlasAnalytics()
    },
    operations: {
      board: createCommerceAtlasOperationsBoard(),
      checklist: createCommerceAtlasShiftChecklist(),
      incidents: createCommerceAtlasIncidentDeck()
    },
    reporting: {
      cards: createCommerceAtlasReportCards(),
      packets: createCommerceAtlasReviewPackets(),
      summary: summarizeCommerceAtlasReporting()
    },
    audit: {
      trail: createCommerceAtlasAuditTrail(),
      manifest: createCommerceAtlasEvidenceManifest(),
      attestation: createCommerceAtlasReadinessAttestation()
    },
    playbooks: createCommerceAtlasPlaybooks(),
    decisions: createCommerceAtlasDecisionDeck(),
    escalationMoments: createCommerceAtlasEscalationMoments()
  };
}

export function createCommerceAtlasReadinessBoard(snapshot = buildCommerceAtlasSnapshot()) {
  return [
    { id: 'commerce-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceAtlasApiDocument(snapshot = buildCommerceAtlasSnapshot()) {
  return {
    id: 'commerce-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-atlas/overview' },
      { method: 'GET', path: '/api/commerce-atlas/reporting' },
      { method: 'POST', path: '/api/commerce-atlas/validate' },
      { method: 'GET', path: '/api/commerce-atlas/audit' }
    ],
    readiness: createCommerceAtlasReadinessBoard(snapshot)
  };
}

export function createCommerceAtlasRouteSummary(snapshot = buildCommerceAtlasSnapshot()) {
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

