export function createAudienceSyncFixtures() {
  return {
    contacts: [
      { id: 'audience-sync-contact-1', email: 'audience.sync+1@example.com', tier: 'growth' },
      { id: 'audience-sync-contact-2', email: 'audience.sync+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'audience-sync-ws-1', name: 'Audience Sync Demo North' },
      { id: 'audience-sync-ws-2', name: 'Audience Sync Demo South' }
    ],
    notes: ['Expansion fixture for Audience Sync', 'Supports test and catalog rendering']
  };
}

export function summarizeAudienceSyncFixtures(fixtures = createAudienceSyncFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
