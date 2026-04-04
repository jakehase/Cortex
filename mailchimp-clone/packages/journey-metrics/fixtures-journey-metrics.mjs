export function createJourneyMetricsFixtures() {
  return {
    contacts: [
      { id: 'journey-metrics-contact-1', email: 'journey.metrics+1@example.com', tier: 'growth' },
      { id: 'journey-metrics-contact-2', email: 'journey.metrics+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'journey-metrics-ws-1', name: 'Journey Metrics Demo North' },
      { id: 'journey-metrics-ws-2', name: 'Journey Metrics Demo South' }
    ],
    notes: ['Expansion fixture for Journey Metrics', 'Supports test and catalog rendering']
  };
}

export function summarizeJourneyMetricsFixtures(fixtures = createJourneyMetricsFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
