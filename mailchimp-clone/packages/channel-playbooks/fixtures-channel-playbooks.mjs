export function createChannelPlaybooksFixtures() {
  return {
    contacts: [
      { id: "channel-playbooks-contact-1", email: "channel-playbooks+1@example.com", tier: 'growth' },
      { id: "channel-playbooks-contact-2", email: "channel-playbooks+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "channel-playbooks-ws-1", name: "Channel Playbooks Demo East" },
      { id: "channel-playbooks-ws-2", name: "Channel Playbooks Demo West" }
    ],
    notes: ["Channel Playbooks fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeChannelPlaybooksFixtures(fixtures = createChannelPlaybooksFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

