export function createSubscriptionIntelligenceFixtures() {
  return {
    contacts: [
      { id: "subscription-intelligence-contact-1", email: "subscription-intelligence+1@example.com", tier: 'growth' },
      { id: "subscription-intelligence-contact-2", email: "subscription-intelligence+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "subscription-intelligence-ws-1", name: "Subscription Intelligence Demo East" },
      { id: "subscription-intelligence-ws-2", name: "Subscription Intelligence Demo West" }
    ],
    notes: ["Subscription Intelligence fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeSubscriptionIntelligenceFixtures(fixtures = createSubscriptionIntelligenceFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

