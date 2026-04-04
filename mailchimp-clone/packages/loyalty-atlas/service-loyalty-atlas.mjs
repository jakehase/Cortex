import { createLoyaltyAtlasWorkspace, summarizeLoyaltyAtlasWorkspace, createLoyaltyAtlasNarratives, createLoyaltyAtlasCoverageGrid } from './domain-loyalty-atlas.mjs';
import { createLoyaltyAtlasPolicies, validateLoyaltyAtlasPolicies, summarizeLoyaltyAtlasPolicies, createLoyaltyAtlasEscalationDeck } from './policies-loyalty-atlas.mjs';
import { createLoyaltyAtlasAnalyticsTimeline, createLoyaltyAtlasForecastEnvelope, createLoyaltyAtlasExceptionLedger, summarizeLoyaltyAtlasAnalytics } from './analytics-loyalty-atlas.mjs';
import { createLoyaltyAtlasOperationsBoard, createLoyaltyAtlasShiftChecklist, createLoyaltyAtlasIncidentDeck } from './operations-loyalty-atlas.mjs';
import { createLoyaltyAtlasReportCards, createLoyaltyAtlasReviewPackets, summarizeLoyaltyAtlasReporting } from './reporting-loyalty-atlas.mjs';
import { createLoyaltyAtlasAuditTrail, createLoyaltyAtlasEvidenceManifest, createLoyaltyAtlasReadinessAttestation } from './audit-loyalty-atlas.mjs';
import { createLoyaltyAtlasPlaybooks, createLoyaltyAtlasDecisionDeck, createLoyaltyAtlasEscalationMoments } from './playbooks-loyalty-atlas.mjs';

export function buildLoyaltyAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyAtlasWorkspace(workspaceName);
  const policies = createLoyaltyAtlasPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyAtlasWorkspace(workspace),
    narratives: createLoyaltyAtlasNarratives(workspace),
    coverage: createLoyaltyAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyAtlasPolicies(policies),
    validation: validateLoyaltyAtlasPolicies(policies),
    escalationDeck: createLoyaltyAtlasEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyAtlasAnalyticsTimeline(),
      forecast: createLoyaltyAtlasForecastEnvelope(),
      exceptions: createLoyaltyAtlasExceptionLedger(),
      summary: summarizeLoyaltyAtlasAnalytics()
    },
    operations: {
      board: createLoyaltyAtlasOperationsBoard(),
      checklist: createLoyaltyAtlasShiftChecklist(),
      incidents: createLoyaltyAtlasIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyAtlasReportCards(),
      packets: createLoyaltyAtlasReviewPackets(),
      summary: summarizeLoyaltyAtlasReporting()
    },
    audit: {
      trail: createLoyaltyAtlasAuditTrail(),
      manifest: createLoyaltyAtlasEvidenceManifest(),
      attestation: createLoyaltyAtlasReadinessAttestation()
    },
    playbooks: createLoyaltyAtlasPlaybooks(),
    decisions: createLoyaltyAtlasDecisionDeck(),
    escalationMoments: createLoyaltyAtlasEscalationMoments()
  };
}

export function createLoyaltyAtlasReadinessBoard(snapshot = buildLoyaltyAtlasSnapshot()) {
  return [
    { id: 'loyalty-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyAtlasApiDocument(snapshot = buildLoyaltyAtlasSnapshot()) {
  return {
    id: 'loyalty-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-atlas/overview' },
      { method: 'GET', path: '/api/loyalty-atlas/reporting' },
      { method: 'POST', path: '/api/loyalty-atlas/validate' },
      { method: 'GET', path: '/api/loyalty-atlas/audit' }
    ],
    readiness: createLoyaltyAtlasReadinessBoard(snapshot)
  };
}

export function createLoyaltyAtlasRouteSummary(snapshot = buildLoyaltyAtlasSnapshot()) {
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

