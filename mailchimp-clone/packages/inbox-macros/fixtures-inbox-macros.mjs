export function createInboxMacrosFixtures() {
  return {
    contacts: [
      { id: 'inbox-macros-contact-1', email: 'inbox.macros+1@example.com', tier: 'growth' },
      { id: 'inbox-macros-contact-2', email: 'inbox.macros+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'inbox-macros-ws-1', name: 'Inbox Macros Demo North' },
      { id: 'inbox-macros-ws-2', name: 'Inbox Macros Demo South' }
    ],
    notes: ['Expansion fixture for Inbox Macros', 'Supports test and catalog rendering']
  };
}

export function summarizeInboxMacrosFixtures(fixtures = createInboxMacrosFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
