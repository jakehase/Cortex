export function createEcommerceInsightsFixtures() {
  return {
    contacts: [
      { id: "ecommerce-insights-contact-1", email: "ecommerce-insights+1@example.com", tier: 'growth' },
      { id: "ecommerce-insights-contact-2", email: "ecommerce-insights+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "ecommerce-insights-ws-1", name: "Ecommerce Insights Demo East" },
      { id: "ecommerce-insights-ws-2", name: "Ecommerce Insights Demo West" }
    ],
    notes: ["Ecommerce Insights fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeEcommerceInsightsFixtures(fixtures = createEcommerceInsightsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

