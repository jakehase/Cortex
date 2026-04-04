export function createReleaseTrainFixtures() {
  return {
    contacts: [
      { id: 'release-train-contact-1', email: 'release.train+1@example.com', tier: 'growth' },
      { id: 'release-train-contact-2', email: 'release.train+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'release-train-ws-1', name: 'Release Train Demo East' },
      { id: 'release-train-ws-2', name: 'Release Train Demo West' }
    ],
    notes: ['Continuation fixture for Release Train', 'Supports regression catalog rendering']
  };
}

export function summarizeReleaseTrainFixtures(fixtures = createReleaseTrainFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
