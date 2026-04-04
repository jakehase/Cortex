export function createEngagementForecastingFixtures() {
  return {
    contacts: [
      { id: "engagement-forecasting-contact-1", email: "engagement-forecasting+1@example.com", tier: 'growth' },
      { id: "engagement-forecasting-contact-2", email: "engagement-forecasting+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "engagement-forecasting-ws-1", name: "Engagement Forecasting Demo East" },
      { id: "engagement-forecasting-ws-2", name: "Engagement Forecasting Demo West" }
    ],
    notes: ["Engagement Forecasting fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeEngagementForecastingFixtures(fixtures = createEngagementForecastingFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

