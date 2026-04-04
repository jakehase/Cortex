import { createComplianceAtlasWorkspace, summarizeComplianceAtlasWorkspace, createComplianceAtlasNarratives, createComplianceAtlasCoverageGrid } from './domain-compliance-atlas.mjs';
import { createComplianceAtlasPolicies, validateComplianceAtlasPolicies, summarizeComplianceAtlasPolicies, createComplianceAtlasEscalationDeck } from './policies-compliance-atlas.mjs';
import { createComplianceAtlasAnalyticsTimeline, createComplianceAtlasForecastEnvelope, createComplianceAtlasExceptionLedger, summarizeComplianceAtlasAnalytics } from './analytics-compliance-atlas.mjs';
import { createComplianceAtlasOperationsBoard, createComplianceAtlasShiftChecklist, createComplianceAtlasIncidentDeck } from './operations-compliance-atlas.mjs';
import { createComplianceAtlasReportCards, createComplianceAtlasReviewPackets, summarizeComplianceAtlasReporting } from './reporting-compliance-atlas.mjs';
import { createComplianceAtlasAuditTrail, createComplianceAtlasEvidenceManifest, createComplianceAtlasReadinessAttestation } from './audit-compliance-atlas.mjs';
import { createComplianceAtlasPlaybooks, createComplianceAtlasDecisionDeck, createComplianceAtlasEscalationMoments } from './playbooks-compliance-atlas.mjs';

export function buildComplianceAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceAtlasWorkspace(workspaceName);
  const policies = createComplianceAtlasPolicies();
  return {
    workspace,
    summary: summarizeComplianceAtlasWorkspace(workspace),
    narratives: createComplianceAtlasNarratives(workspace),
    coverage: createComplianceAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceAtlasPolicies(policies),
    validation: validateComplianceAtlasPolicies(policies),
    escalationDeck: createComplianceAtlasEscalationDeck(policies),
    analytics: {
      timeline: createComplianceAtlasAnalyticsTimeline(),
      forecast: createComplianceAtlasForecastEnvelope(),
      exceptions: createComplianceAtlasExceptionLedger(),
      summary: summarizeComplianceAtlasAnalytics()
    },
    operations: {
      board: createComplianceAtlasOperationsBoard(),
      checklist: createComplianceAtlasShiftChecklist(),
      incidents: createComplianceAtlasIncidentDeck()
    },
    reporting: {
      cards: createComplianceAtlasReportCards(),
      packets: createComplianceAtlasReviewPackets(),
      summary: summarizeComplianceAtlasReporting()
    },
    audit: {
      trail: createComplianceAtlasAuditTrail(),
      manifest: createComplianceAtlasEvidenceManifest(),
      attestation: createComplianceAtlasReadinessAttestation()
    },
    playbooks: createComplianceAtlasPlaybooks(),
    decisions: createComplianceAtlasDecisionDeck(),
    escalationMoments: createComplianceAtlasEscalationMoments()
  };
}

export function createComplianceAtlasReadinessBoard(snapshot = buildComplianceAtlasSnapshot()) {
  return [
    { id: 'compliance-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceAtlasApiDocument(snapshot = buildComplianceAtlasSnapshot()) {
  return {
    id: 'compliance-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-atlas/overview' },
      { method: 'GET', path: '/api/compliance-atlas/reporting' },
      { method: 'POST', path: '/api/compliance-atlas/validate' },
      { method: 'GET', path: '/api/compliance-atlas/audit' }
    ],
    readiness: createComplianceAtlasReadinessBoard(snapshot)
  };
}

export function createComplianceAtlasRouteSummary(snapshot = buildComplianceAtlasSnapshot()) {
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

