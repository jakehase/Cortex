import { createEcommerceAtlasWorkspace, summarizeEcommerceAtlasWorkspace, createEcommerceAtlasNarratives, createEcommerceAtlasCoverageGrid } from './domain-ecommerce-atlas.mjs';
import { createEcommerceAtlasPolicies, validateEcommerceAtlasPolicies, summarizeEcommerceAtlasPolicies, createEcommerceAtlasEscalationDeck } from './policies-ecommerce-atlas.mjs';
import { createEcommerceAtlasAnalyticsTimeline, createEcommerceAtlasForecastEnvelope, createEcommerceAtlasExceptionLedger, summarizeEcommerceAtlasAnalytics } from './analytics-ecommerce-atlas.mjs';
import { createEcommerceAtlasOperationsBoard, createEcommerceAtlasShiftChecklist, createEcommerceAtlasIncidentDeck } from './operations-ecommerce-atlas.mjs';
import { createEcommerceAtlasReportCards, createEcommerceAtlasReviewPackets, summarizeEcommerceAtlasReporting } from './reporting-ecommerce-atlas.mjs';
import { createEcommerceAtlasAuditTrail, createEcommerceAtlasEvidenceManifest, createEcommerceAtlasReadinessAttestation } from './audit-ecommerce-atlas.mjs';
import { createEcommerceAtlasPlaybooks, createEcommerceAtlasDecisionDeck, createEcommerceAtlasEscalationMoments } from './playbooks-ecommerce-atlas.mjs';

export function buildEcommerceAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceAtlasWorkspace(workspaceName);
  const policies = createEcommerceAtlasPolicies();
  return {
    workspace,
    summary: summarizeEcommerceAtlasWorkspace(workspace),
    narratives: createEcommerceAtlasNarratives(workspace),
    coverage: createEcommerceAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceAtlasPolicies(policies),
    validation: validateEcommerceAtlasPolicies(policies),
    escalationDeck: createEcommerceAtlasEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceAtlasAnalyticsTimeline(),
      forecast: createEcommerceAtlasForecastEnvelope(),
      exceptions: createEcommerceAtlasExceptionLedger(),
      summary: summarizeEcommerceAtlasAnalytics()
    },
    operations: {
      board: createEcommerceAtlasOperationsBoard(),
      checklist: createEcommerceAtlasShiftChecklist(),
      incidents: createEcommerceAtlasIncidentDeck()
    },
    reporting: {
      cards: createEcommerceAtlasReportCards(),
      packets: createEcommerceAtlasReviewPackets(),
      summary: summarizeEcommerceAtlasReporting()
    },
    audit: {
      trail: createEcommerceAtlasAuditTrail(),
      manifest: createEcommerceAtlasEvidenceManifest(),
      attestation: createEcommerceAtlasReadinessAttestation()
    },
    playbooks: createEcommerceAtlasPlaybooks(),
    decisions: createEcommerceAtlasDecisionDeck(),
    escalationMoments: createEcommerceAtlasEscalationMoments()
  };
}

export function createEcommerceAtlasReadinessBoard(snapshot = buildEcommerceAtlasSnapshot()) {
  return [
    { id: 'ecommerce-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceAtlasApiDocument(snapshot = buildEcommerceAtlasSnapshot()) {
  return {
    id: 'ecommerce-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-atlas/overview' },
      { method: 'GET', path: '/api/ecommerce-atlas/reporting' },
      { method: 'POST', path: '/api/ecommerce-atlas/validate' },
      { method: 'GET', path: '/api/ecommerce-atlas/audit' }
    ],
    readiness: createEcommerceAtlasReadinessBoard(snapshot)
  };
}

export function createEcommerceAtlasRouteSummary(snapshot = buildEcommerceAtlasSnapshot()) {
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

