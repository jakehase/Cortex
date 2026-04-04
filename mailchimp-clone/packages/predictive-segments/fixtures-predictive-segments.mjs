export function createPredictiveSegmentsFixtures() {
  return {
    contacts: [
      { id: "predictive-segments-contact-1", email: "predictive-segments+1@example.com", tier: 'growth' },
      { id: "predictive-segments-contact-2", email: "predictive-segments+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "predictive-segments-ws-1", name: "Predictive Segments Demo East" },
      { id: "predictive-segments-ws-2", name: "Predictive Segments Demo West" }
    ],
    notes: ["Predictive Segments fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizePredictiveSegmentsFixtures(fixtures = createPredictiveSegmentsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

