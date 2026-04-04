import { createAcquisitionFoundryWorkspace, summarizeAcquisitionFoundryWorkspace, createAcquisitionFoundryNarratives, createAcquisitionFoundryCoverageGrid } from './domain-acquisition-foundry.mjs';
import { createAcquisitionFoundryPolicies, validateAcquisitionFoundryPolicies, summarizeAcquisitionFoundryPolicies, createAcquisitionFoundryEscalationDeck } from './policies-acquisition-foundry.mjs';
import { createAcquisitionFoundryAnalyticsTimeline, createAcquisitionFoundryForecastEnvelope, createAcquisitionFoundryExceptionLedger, summarizeAcquisitionFoundryAnalytics } from './analytics-acquisition-foundry.mjs';
import { createAcquisitionFoundryOperationsBoard, createAcquisitionFoundryShiftChecklist, createAcquisitionFoundryIncidentDeck } from './operations-acquisition-foundry.mjs';
import { createAcquisitionFoundryReportCards, createAcquisitionFoundryReviewPackets, summarizeAcquisitionFoundryReporting } from './reporting-acquisition-foundry.mjs';
import { createAcquisitionFoundryAuditTrail, createAcquisitionFoundryEvidenceManifest, createAcquisitionFoundryReadinessAttestation } from './audit-acquisition-foundry.mjs';
import { createAcquisitionFoundryPlaybooks, createAcquisitionFoundryDecisionDeck, createAcquisitionFoundryEscalationMoments } from './playbooks-acquisition-foundry.mjs';

export function buildAcquisitionFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionFoundryWorkspace(workspaceName);
  const policies = createAcquisitionFoundryPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionFoundryWorkspace(workspace),
    narratives: createAcquisitionFoundryNarratives(workspace),
    coverage: createAcquisitionFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionFoundryPolicies(policies),
    validation: validateAcquisitionFoundryPolicies(policies),
    escalationDeck: createAcquisitionFoundryEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionFoundryAnalyticsTimeline(),
      forecast: createAcquisitionFoundryForecastEnvelope(),
      exceptions: createAcquisitionFoundryExceptionLedger(),
      summary: summarizeAcquisitionFoundryAnalytics()
    },
    operations: {
      board: createAcquisitionFoundryOperationsBoard(),
      checklist: createAcquisitionFoundryShiftChecklist(),
      incidents: createAcquisitionFoundryIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionFoundryReportCards(),
      packets: createAcquisitionFoundryReviewPackets(),
      summary: summarizeAcquisitionFoundryReporting()
    },
    audit: {
      trail: createAcquisitionFoundryAuditTrail(),
      manifest: createAcquisitionFoundryEvidenceManifest(),
      attestation: createAcquisitionFoundryReadinessAttestation()
    },
    playbooks: createAcquisitionFoundryPlaybooks(),
    decisions: createAcquisitionFoundryDecisionDeck(),
    escalationMoments: createAcquisitionFoundryEscalationMoments()
  };
}

export function createAcquisitionFoundryReadinessBoard(snapshot = buildAcquisitionFoundrySnapshot()) {
  return [
    { id: 'acquisition-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionFoundryApiDocument(snapshot = buildAcquisitionFoundrySnapshot()) {
  return {
    id: 'acquisition-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-foundry/overview' },
      { method: 'GET', path: '/api/acquisition-foundry/reporting' },
      { method: 'POST', path: '/api/acquisition-foundry/validate' },
      { method: 'GET', path: '/api/acquisition-foundry/audit' }
    ],
    readiness: createAcquisitionFoundryReadinessBoard(snapshot)
  };
}

export function createAcquisitionFoundryRouteSummary(snapshot = buildAcquisitionFoundrySnapshot()) {
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

