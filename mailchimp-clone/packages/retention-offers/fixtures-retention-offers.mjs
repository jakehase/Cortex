export function createRetentionOffersFixtures() {
  return {
    contacts: [
      { id: "retention-offers-contact-1", email: "retention-offers+1@example.com", tier: 'growth' },
      { id: "retention-offers-contact-2", email: "retention-offers+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "retention-offers-ws-1", name: "Retention Offers Demo East" },
      { id: "retention-offers-ws-2", name: "Retention Offers Demo West" }
    ],
    notes: ["Retention Offers fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeRetentionOffersFixtures(fixtures = createRetentionOffersFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

