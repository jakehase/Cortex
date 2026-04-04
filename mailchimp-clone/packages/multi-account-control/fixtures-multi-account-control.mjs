export function createMultiAccountControlFixtures() {
  return {
    contacts: [
      { id: "multi-account-control-contact-1", email: "multi-account-control+1@example.com", tier: 'growth' },
      { id: "multi-account-control-contact-2", email: "multi-account-control+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "multi-account-control-ws-1", name: "Multi-Account Control Demo East" },
      { id: "multi-account-control-ws-2", name: "Multi-Account Control Demo West" }
    ],
    notes: ["Multi-Account Control fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeMultiAccountControlFixtures(fixtures = createMultiAccountControlFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

