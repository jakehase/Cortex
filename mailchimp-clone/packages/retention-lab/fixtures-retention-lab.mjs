export function createRetentionLabFixtures() {
  return {
    contacts: [
      { id: 'retention-lab-contact-1', email: 'retention.lab+1@example.com', tier: 'growth' },
      { id: 'retention-lab-contact-2', email: 'retention.lab+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'retention-lab-ws-1', name: 'Retention Lab Demo North' },
      { id: 'retention-lab-ws-2', name: 'Retention Lab Demo South' }
    ],
    notes: ['Expansion fixture for Retention Lab', 'Supports test and catalog rendering']
  };
}

export function summarizeRetentionLabFixtures(fixtures = createRetentionLabFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
