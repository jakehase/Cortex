export function createRevenueAttributionFixtures() {
  return {
    contacts: [
      { id: "revenue-attribution-contact-1", email: "revenue-attribution+1@example.com", tier: 'growth' },
      { id: "revenue-attribution-contact-2", email: "revenue-attribution+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "revenue-attribution-ws-1", name: "Revenue Attribution Demo East" },
      { id: "revenue-attribution-ws-2", name: "Revenue Attribution Demo West" }
    ],
    notes: ["Revenue Attribution fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeRevenueAttributionFixtures(fixtures = createRevenueAttributionFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

