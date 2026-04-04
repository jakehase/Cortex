export function createAttributionModelingFixtures() {
  return {
    contacts: [
      { id: "attribution-modeling-contact-1", email: "attribution-modeling+1@example.com", tier: 'growth' },
      { id: "attribution-modeling-contact-2", email: "attribution-modeling+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "attribution-modeling-ws-1", name: "Attribution Modeling Demo East" },
      { id: "attribution-modeling-ws-2", name: "Attribution Modeling Demo West" }
    ],
    notes: ["Attribution Modeling fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeAttributionModelingFixtures(fixtures = createAttributionModelingFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

