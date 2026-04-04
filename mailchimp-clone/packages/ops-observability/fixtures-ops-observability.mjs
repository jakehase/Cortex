export function createOpsObservabilityFixtures() {
  return {
    contacts: [
      { id: 'ops-observability-contact-1', email: 'ops.observability+1@example.com', tier: 'growth' },
      { id: 'ops-observability-contact-2', email: 'ops.observability+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'ops-observability-ws-1', name: 'Ops Observability Demo North' },
      { id: 'ops-observability-ws-2', name: 'Ops Observability Demo South' }
    ],
    notes: ['Expansion fixture for Ops Observability', 'Supports test and catalog rendering']
  };
}

export function summarizeOpsObservabilityFixtures(fixtures = createOpsObservabilityFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
