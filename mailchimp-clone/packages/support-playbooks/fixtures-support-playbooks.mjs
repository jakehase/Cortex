export function createSupportPlaybooksFixtures() {
  return {
    contacts: [
      { id: 'support-playbooks-contact-1', email: 'support.playbooks+1@example.com', tier: 'growth' },
      { id: 'support-playbooks-contact-2', email: 'support.playbooks+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'support-playbooks-ws-1', name: 'Support Playbooks Demo North' },
      { id: 'support-playbooks-ws-2', name: 'Support Playbooks Demo South' }
    ],
    notes: ['Expansion fixture for Support Playbooks', 'Supports test and catalog rendering']
  };
}

export function summarizeSupportPlaybooksFixtures(fixtures = createSupportPlaybooksFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
