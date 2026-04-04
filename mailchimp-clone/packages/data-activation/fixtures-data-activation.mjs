export function createDataActivationFixtures() {
  return {
    contacts: [
      { id: "data-activation-contact-1", email: "data-activation+1@example.com", tier: 'growth' },
      { id: "data-activation-contact-2", email: "data-activation+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "data-activation-ws-1", name: "Data Activation Demo East" },
      { id: "data-activation-ws-2", name: "Data Activation Demo West" }
    ],
    notes: ["Data Activation fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeDataActivationFixtures(fixtures = createDataActivationFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

