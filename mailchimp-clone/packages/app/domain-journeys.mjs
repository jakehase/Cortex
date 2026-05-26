export { AUTOMATION_TRIGGERS, CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT, automationRunSummary, buildCrossChannelJourneyRuntimeSnapshot, createAutomation, persistCrossChannelJourneyRuntimeSnapshot, recordCrossChannelJourneyDecisionEvent, recordCrossChannelJourneyHandoffEvent, recordCrossChannelJourneyNodeConfig, recordCrossChannelJourneyPerformanceEvent, triggerAutomationEvent, triggerAutomationsForEvent, updateAutomationLifecycle, validateAutomation } from './domain-growth.mjs';

export function journeyWorkspaceSummary(state, workspaceId) {
  const journeys = state.db.automations.filter((entry) => entry.workspaceId === workspaceId);
  const runs = state.db.automationRuns.filter((run) => run.workspaceId === workspaceId || journeys.some((journey) => journey.id === run.automationId));
  return {
    journeys: journeys.length,
    live: journeys.filter((entry) => entry.status === 'live').length,
    paused: journeys.filter((entry) => entry.status === 'paused').length,
    draft: journeys.filter((entry) => ['draft', 'broken'].includes(entry.status)).length,
    runs: runs.length,
    goalReached: runs.filter((run) => run.goalReached).length,
    recentRuns: runs.slice(0, 6)
  };
}

export function journeyTemplateCoverage(state) {
  return (state.db.journeyTemplates || []).map((template) => ({
    id: template.id,
    name: template.name,
    nodeTypes: [...new Set((template.nodes || []).map((node) => node.type))],
    nodes: (template.nodes || []).length
  }));
}
