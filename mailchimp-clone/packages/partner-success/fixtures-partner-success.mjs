export function createPartnerSuccessFixtures() {
  return {
    contacts: [
      { id: 'partner-success-contact-1', email: 'partner.success+1@example.com', tier: 'growth' },
      { id: 'partner-success-contact-2', email: 'partner.success+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'partner-success-ws-1', name: 'Partner Success Demo North' },
      { id: 'partner-success-ws-2', name: 'Partner Success Demo South' }
    ],
    notes: ['Expansion fixture for Partner Success', 'Supports test and catalog rendering']
  };
}

export function summarizePartnerSuccessFixtures(fixtures = createPartnerSuccessFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
