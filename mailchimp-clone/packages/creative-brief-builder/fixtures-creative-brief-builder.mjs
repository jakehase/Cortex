export function createCreativeBriefBuilderFixtures() {
  return {
    contacts: [
      { id: "creative-brief-builder-contact-1", email: "creative-brief-builder+1@example.com", tier: 'growth' },
      { id: "creative-brief-builder-contact-2", email: "creative-brief-builder+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "creative-brief-builder-ws-1", name: "Creative Brief Builder Demo East" },
      { id: "creative-brief-builder-ws-2", name: "Creative Brief Builder Demo West" }
    ],
    notes: ["Creative Brief Builder fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeCreativeBriefBuilderFixtures(fixtures = createCreativeBriefBuilderFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

