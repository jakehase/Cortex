export function createReleaseCommandCenterFixtures() {
  return {
    contacts: [
      { id: "release-command-center-contact-1", email: "release-command-center+1@example.com", tier: 'growth' },
      { id: "release-command-center-contact-2", email: "release-command-center+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "release-command-center-ws-1", name: "Release Command Center Demo East" },
      { id: "release-command-center-ws-2", name: "Release Command Center Demo West" }
    ],
    notes: ["Release Command Center fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeReleaseCommandCenterFixtures(fixtures = createReleaseCommandCenterFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

