export function createCreativeQaFixtures() {
  return {
    contacts: [
      { id: "creative-qa-contact-1", email: "creative-qa+1@example.com", tier: 'growth' },
      { id: "creative-qa-contact-2", email: "creative-qa+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "creative-qa-ws-1", name: "Creative QA Demo East" },
      { id: "creative-qa-ws-2", name: "Creative QA Demo West" }
    ],
    notes: ["Creative QA fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeCreativeQaFixtures(fixtures = createCreativeQaFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

